import { useMemo, useState } from "react";
import "./App.css";

const INITIAL_AGENTS = [
  { id: 1, name: "Juan" },
  { id: 2, name: "Pedro" },
  { id: 3, name: "Carlos" },
  { id: 4, name: "Luis" },
  { id: 5, name: "Miguel" },
];

const INITIAL_DEMAND = [
  { id: 1, start: "00:00", end: "01:00", booths: 2 },
  { id: 2, start: "01:00", end: "05:00", booths: 1 },
  { id: 3, start: "05:00", end: "06:00", booths: 3 },
];

// =========================================================
// UTILIDADES
// =========================================================

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const mins = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  return `${hours}h ${mins}m`;
}

// =========================================================
// VALIDACIÃ“N
// =========================================================

function validateDemand(agents, demand) {
  if (agents.length === 0) return "Debe existir al menos un agente.";
  if (demand.length === 0) return "Debe existir al menos un intervalo de demanda.";

  const normalized = demand.map((item) => ({
    ...item,
    startMinutes: timeToMinutes(item.start),
    endMinutes: timeToMinutes(item.end),
  }));

  for (const item of normalized) {
    if (item.startMinutes >= item.endMinutes) {
      return `Horario invÃ¡lido: ${item.start} â†’ ${item.end}`;
    }
    if (item.booths < 1) {
      return "La cantidad de casillas debe ser mayor a 0.";
    }
    if (item.booths > agents.length) {
      return (
        `El intervalo ${item.start} â†’ ${item.end} requiere ${item.booths} ` +
        `casillas pero solo hay ${agents.length} agentes.`
      );
    }
  }

  const sorted = [...normalized].sort((a, b) =>
    a.startMinutes !== b.startMinutes ? a.startMinutes - b.startMinutes : a.id - b.id
  );

  // La demanda es absoluta: no permitimos superposiciÃ³n.
  // Una casilla extra que se abre "en el medio" de otro intervalo no se
  // modela como solapamiento, sino como un intervalo nuevo y adyacente
  // (ej: en vez de "1 casilla 01â†’05", cargÃ¡s "1 casilla 01â†’02",
  // "2 casillas 02â†’03", "1 casilla 03â†’05"). El resto del motor no necesita
  // saber que eso es una apertura excepcional: es un intervalo mÃ¡s.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinutes < sorted[i - 1].endMinutes) {
      return (
        `Hay intervalos superpuestos: ${sorted[i - 1].start} â†’ ${sorted[i - 1].end} ` +
        `y ${sorted[i].start} â†’ ${sorted[i].end}`
      );
    }
  }

  return null;
}

function calculateTotalWork(demand) {
  return demand.reduce((total, item) => {
    const duration = timeToMinutes(item.end) - timeToMinutes(item.start);
    return total + duration * item.booths;
  }, 0);
}

// =========================================================
// CRITERIO ÃšNICO DE PRIORIDAD
//
// Esta es la Ãºnica regla de selecciÃ³n de todo el motor:
//   1) menor cantidad de minutos acumulados hasta el momento
//   2) a igualdad, menor ID (orden de llegada)
//
// Se usa tanto para elegir quiÃ©n entra a un bloque rÃ­gido (varias
// casillas simultÃ¡neas) como para elegir quiÃ©n sigue en el relleno
// flexible (una casilla). No hay heurÃ­sticas separadas ("capas",
// "distribuciÃ³n desde los extremos") para cada caso.
// =========================================================

function pickLeastLoaded(agents, loadOf, quantity) {
  return [...agents]
    .sort((a, b) => {
      const diff = loadOf(a) - loadOf(b);
      return diff !== 0 ? diff : a.id - b.id;
    })
    .slice(0, quantity);
}

function addAssignment(agent, start, end, booth) {
  if (end <= start) return;

  const last = agent.assignments[agent.assignments.length - 1];

  // Si el turno nuevo continÃºa inmediatamente en la misma casilla,
  // lo unimos en vez de crear un segmento aparte.
  if (last && last.end === start && last.booth === booth) {
    last.end = end;
    last.minutes += end - start;
    return;
  }

  agent.assignments.push({ start, end, booth, minutes: end - start });
}

// =========================================================
// OBJETIVO POR AGENTE
//
// Se calcula una sola vez, al principio: es el "ancla" contra la que
// el relleno flexible sabe cuÃ¡ndo dejar de darle minutos a alguien.
// =========================================================

function calculateTargets(agents, totalWork) {
  const sortedById = [...agents].sort((a, b) => a.id - b.id);

  const base = Math.floor(totalWork / sortedById.length);
  const remainder = totalWork % sortedById.length;

  // El resto (si la divisiÃ³n no es exacta) se lo lleva primero
  // quien llegÃ³ antes.
  return new Map(
    sortedById.map((agent, index) => [agent.id, base + (index < remainder ? 1 : 0)])
  );
}

// =========================================================
// FASE 1 â€” BLOQUES RÃGIDOS (2+ casillas simultÃ¡neas)
//
// Se procesan TODOS los bloques rÃ­gidos primero, en orden cronolÃ³gico,
// antes de tocar cualquier casilla individual. Esto es necesario:
// como un bloque rÃ­gido no se puede partir entre agentes, hay que
// "reservar" a los agentes menos cargados para Ã©l antes de que el
// relleno flexible los gaste completando objetivos.
//
// Un bloque rÃ­gido puede aparecer en cualquier punto del dÃ­a (al
// principio, al final, o abrirse transitoriamente a mitad de otro
// intervalo): no hay ninguna suposiciÃ³n sobre su posiciÃ³n, solo se
// procesan en el orden en que ocurren.
// =========================================================

function planRigidBlocks(agents, rigidIntervals) {
  const rigidMinutes = new Map(agents.map((agent) => [agent.id, 0]));
  const plan = [];

  for (const interval of rigidIntervals) {
    const start = timeToMinutes(interval.start);
    const end = timeToMinutes(interval.end);
    const duration = end - start;

    const selected = pickLeastLoaded(
      agents,
      (agent) => rigidMinutes.get(agent.id),
      interval.booths
    ).sort((a, b) => a.id - b.id); // menor ID â†’ casilla 1, etc.

    selected.forEach((agent, index) => {
      plan.push({ agentId: agent.id, booth: index + 1, start, end });
      rigidMinutes.set(agent.id, rigidMinutes.get(agent.id) + duration);
    });
  }

  return { rigidMinutes, plan };
}

function applyRigidPlan(agents, plan) {
  for (const item of plan) {
    const agent = agents.find((a) => a.id === item.agentId);
    if (!agent) continue;

    addAssignment(agent, item.start, item.end, item.booth);
    agent.minutes += item.end - item.start;
  }
}

// =========================================================
// FASE 2 â€” RELLENO FLEXIBLE (1 casilla)
//
// A diferencia de los bloques rÃ­gidos, una casilla individual SÃ se
// puede repartir entre varios agentes dentro del mismo intervalo:
// cada uno toma la casilla hasta llegar a su objetivo (o hasta que
// se acabe el intervalo) y despuÃ©s releva el siguiente.
//
// No se simula minuto a minuto: se entrega el intervalo en "cuotas",
// una por cada cambio de agente.
// =========================================================

function pickNextFlexibleAgent(agents, targets, current) {
  // Continuidad: si el agente que ya estaba en la casilla todavÃ­a
  // necesita minutos, sigue Ã©l antes que evaluar a cualquier otro.
  // Esto evita cortes artificiales tipo "Juan 1 min, Pedro 1 min...".
  const continuing = agents.find((agent) => {
    const last = agent.assignments[agent.assignments.length - 1];
    return last && last.end === current && targets.get(agent.id) - agent.minutes > 0;
  });

  if (continuing) {
    return { agent: continuing, remaining: targets.get(continuing.id) - continuing.minutes };
  }

  const stillNeeding = agents
    .map((agent) => ({ agent, remaining: targets.get(agent.id) - agent.minutes }))
    .filter((item) => item.remaining > 0)
    .sort((a, b) => (b.remaining !== a.remaining ? b.remaining - a.remaining : a.agent.id - b.agent.id));

  if (stillNeeding.length > 0) return stillNeeding[0];

  // Si ya nadie necesita mÃ¡s minutos (puede pasar por redondeos o por
  // sobrecarga de los bloques rÃ­gidos), el intervalo igual hay que
  // cubrirlo: lo absorbe quien tenga menos carga total.
  const [lowest] = pickLeastLoaded(agents, (agent) => agent.minutes, 1);
  return { agent: lowest, remaining: Infinity };
}

function assignFlexibleInterval(agents, interval, targets) {
  let current = timeToMinutes(interval.start);
  const end = timeToMinutes(interval.end);

  while (current < end) {
    const { agent, remaining } = pickNextFlexibleAgent(agents, targets, current);
    const duration = Math.min(remaining, end - current);

    if (!agent || duration <= 0) break;

    addAssignment(agent, current, current + duration, 1);
    agent.minutes += duration;
    current += duration;
  }
}

// =========================================================
// VALIDACIÃ“N FINAL DEL SCHEDULE
// =========================================================

function validateGeneratedSchedule(agents, demand) {
  for (const interval of demand) {
    const start = timeToMinutes(interval.start);
    const end = timeToMinutes(interval.end);

    for (let minute = start; minute < end; minute++) {
      let activeCount = 0;

      for (const agent of agents) {
        const active = agent.assignments.filter(
          (a) => a.start <= minute && a.end > minute
        );

        if (active.length > 1) {
          return `El agente ${agent.name} estÃ¡ asignado a mÃ¡s de una casilla simultÃ¡neamente.`;
        }

        activeCount += active.length;
      }

      if (activeCount !== interval.booths) {
        return (
          `La demanda ${interval.start} â†’ ${interval.end} requiere ${interval.booths} ` +
          `casillas, pero el minuto ${minutesToTime(minute)} tiene ${activeCount} asignadas.`
        );
      }
    }
  }

  return null;
}

// =========================================================
// GENERADOR PRINCIPAL
// =========================================================

export function generateSchedule(agentsInput, demand) {
  const error = validateDemand(agentsInput, demand);
  if (error) return { error, schedule: [], stats: null };

  const agents = agentsInput.map((agent) => ({ ...agent, minutes: 0, assignments: [] }));

  const sortedDemand = [...demand].sort((a, b) => {
    const startA = timeToMinutes(a.start);
    const startB = timeToMinutes(b.start);
    return startA !== startB ? startA - startB : a.id - b.id;
  });

  const totalWork = calculateTotalWork(sortedDemand);
  const targets = calculateTargets(agents, totalWork);

  // Fase 1: todos los bloques rÃ­gidos (booths >= 2), en orden cronolÃ³gico.
  const rigidIntervals = sortedDemand.filter((item) => item.booths >= 2);
  const { plan } = planRigidBlocks(agents, rigidIntervals);
  applyRigidPlan(agents, plan);

  // Fase 2: relleno flexible (booths === 1), en orden cronolÃ³gico,
  // usando como objetivo lo que falta para llegar a `targets`.
  const flexibleIntervals = sortedDemand.filter((item) => item.booths === 1);
  for (const interval of flexibleIntervals) {
    assignFlexibleInterval(agents, interval, targets);
  }

  const scheduleError = validateGeneratedSchedule(agents, sortedDemand);
  if (scheduleError) return { error: scheduleError, schedule: [], stats: null };

  for (const agent of agents) {
  agent.assignments.sort((a, b) => a.start - b.start);

  const loads = agents.map((agent) => agent.minutes);
  const minMinutes = Math.min(...loads);
  const maxMinutes = Math.max(...loads);

  return {
    error: null,
    schedule: agents,
    stats: {
      totalWork,
      target: totalWork / agents.length,
      minMinutes,
      maxMinutes,
      difference: maxMinutes - minMinutes,
    },
  };
}

// =========================================================
// TESTS MANUALES DEL MOTOR
// =========================================================

/*export function runSchedulerTests() {
  const agents = [
    { id: 1, name: "Juan" },
    { id: 2, name: "Pedro" },
    { id: 3, name: "Carlos" },
    { id: 4, name: "Luis" },
    { id: 5, name: "Miguel" },
  ];

  // TEST 1
  // 2 casillas durante una hora, arrancando todos en 0.
  // Con el criterio Ãºnico (menor carga, menor ID) deben entrar
  // los DOS PRIMEROS por orden de llegada: Juan (1) y Pedro (2).
  const test1 = generateSchedule(agents, [
    { id: 1, start: "00:00", end: "01:00", booths: 2 },
  ]);

  console.assert(!test1.error, "TEST 1: no deberÃ­a haber error.");

  const test1Assignments = test1.schedule.flatMap((agent) =>
    agent.assignments.map((a) => ({ agentId: agent.id, booth: a.booth }))
  );

  console.assert(
    test1Assignments.some((item) => item.agentId === 1 && item.booth === 1),
    "TEST 1: Juan debe estar en Casilla 1."
  );
  console.assert(
    test1Assignments.some((item) => item.agentId === 2 && item.booth === 2),
    "TEST 1: Pedro debe estar en Casilla 2."
  );

  // TEST 2
  // 00â†’01 (2 casillas) + 05â†’06 (3 casillas): entre los dos bloques
  // rÃ­gidos participan los 5 agentes exactamente una vez, 60 min c/u.
  const test2 = generateSchedule(agents, [
    { id: 1, start: "00:00", end: "01:00", booths: 2 },
    { id: 2, start: "05:00", end: "06:00", booths: 3 },
  ]);

  console.assert(!test2.error, "TEST 2: no deberÃ­a haber error.");
  console.assert(
    test2.schedule.every((agent) => agent.minutes === 60),
    "TEST 2: todos deberÃ­an tener 60 min."
  );

  // TEST 3
  // 2 casillas 00â†’01 + 1 casilla 01â†’02.
  const test3 = generateSchedule(agents, [
    { id: 1, start: "00:00", end: "01:00", booths: 2 },
    { id: 2, start: "01:00", end: "02:00", booths: 1 },
  ]);

  console.assert(!test3.error, "TEST 3: no deberÃ­a haber error.");

  const juan = test3.schedule.find((agent) => agent.id === 1);
  const pedro = test3.schedule.find((agent) => agent.id === 2);

  console.assert(juan.minutes === 60, "TEST 3: Juan debe terminar con 60 min.");
  console.assert(pedro.minutes === 60, "TEST 3: Pedro debe terminar con 60 min.");

  // TEST 4
  // Caso completo: 00â†’01 (2) + 01â†’05 (1) + 05â†’06 (3).
  // Total = 540 min â†’ 108 por agente, sin diferencia.
  const test4 = generateSchedule(agents, INITIAL_DEMAND);

  console.assert(!test4.error, "TEST 4: no deberÃ­a haber error.");
  console.assert(test4.stats.target === 108, "TEST 4: objetivo esperado = 108 min.");
  console.assert(
    test4.schedule.every((agent) => agent.minutes === 108),
    "TEST 4: todos deberÃ­an terminar con 108 min."
  );
  console.assert(test4.stats.difference === 0, "TEST 4: diferencia esperada = 0.");

  // TEST 5
  // Casilla extra que se abre a mitad de un turno: en vez de
  // "1 casilla 01â†’05" cargamos "1 casilla 01â†’02" + "2 casillas 02â†’03"
  // + "1 casilla 03â†’05". No deberÃ­a requerir ningÃºn caso especial.
  const test5 = generateSchedule(agents, [
    { id: 1, start: "00:00", end: "01:00", booths: 2 },
    { id: 2, start: "01:00", end: "02:00", booths: 1 },
    { id: 3, start: "02:00", end: "03:00", booths: 2 },
    { id: 4, start: "03:00", end: "05:00", booths: 1 },
    { id: 5, start: "05:00", end: "06:00", booths: 3 },
  ]);

  console.assert(!test5.error, "TEST 5: no deberÃ­a haber error.");
  console.assert(
    test5.stats.difference <= 1,
    "TEST 5: la diferencia entre el mÃ¡s y el menos cargado deberÃ­a ser mÃ­nima."
  );

  return { test1, test2, test3, test4, test5 };
}
*/
// =========================================================
// COMPONENTE REACT
// (sin cambios de UI respecto del original â€” solo consume el motor)
// =========================================================

export default function App() {
  const [agents, setAgents] = useState(INITIAL_AGENTS);
  const [demand, setDemand] = useState(INITIAL_DEMAND);

  const result = useMemo(() => generateSchedule(agents, demand), [agents, demand]);

  function addAgent() {
    const nextId = Math.max(0, ...agents.map((a) => a.id)) + 1;
    setAgents([...agents, { id: nextId, name: `Agente ${nextId}` }]);
  }

  function removeAgent(id) {
    setAgents(agents.filter((agent) => agent.id !== id));
  }

  function updateAgent(id, name) {
    setAgents(agents.map((agent) => (agent.id === id ? { ...agent, name } : agent)));
  }

  function addDemand() {
    const nextId = Math.max(0, ...demand.map((d) => d.id)) + 1;
    setDemand([...demand, { id: nextId, start: "00:00", end: "01:00", booths: 1 }]);
  }

  function removeDemand(id) {
    setDemand(demand.filter((item) => item.id !== id));
  }

  function updateDemand(id, field, value) {
    setDemand(
      demand.map((item) =>
        item.id === id
          ? { ...item, [field]: field === "booths" ? Number(value) : value }
          : item
      )
    );
  }

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>GestiÃ³n de horarios</h1>
          <p>DistribuciÃ³n automÃ¡tica de agentes y casillas</p>
        </header>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Agentes</h2>
              <p className="card-description">El ID determina el orden de llegada.</p>
            </div>
          </div>

          <div className="agent-list">
            {agents.map((agent) => (
              <div key={agent.id} className="agent-row">
                <div className="agent-number">{agent.id}</div>
                <input
                  className="input input-name"
                  value={agent.name}
                  onChange={(event) => updateAgent(agent.id, event.target.value)}
                />
                <button className="button button-danger" onClick={() => removeAgent(agent.id)}>
                  Eliminar
                </button>
              </div>
            ))}
          </div>

          <button className="button button-primary" onClick={addAgent}>
            + Agregar agente
          </button>
        </section>

        <section style={{ marginTop: 40 }}>
          <h2>Horarios de casillas</h2>
          <p>
            Los bloques con varias casillas se mantienen completos. Las casillas
            individuales se utilizan posteriormente para completar los minutos
            faltantes, respetando el orden de llegada.
          </p>

          <div className="demand-list">
            {demand.map((item) => (
              <div key={item.id} className="demand-row">
                <input
                  className="input input-time"
                  type="time"
                  value={item.start}
                  onChange={(event) => updateDemand(item.id, "start", event.target.value)}
                />
                <span className="time-arrow">â†’</span>
                <input
                  className="input input-time"
                  type="time"
                  value={item.end}
                  onChange={(event) => updateDemand(item.id, "end", event.target.value)}
                />
                <div className="field">
                  <span className="field-label">Casillas:</span>
                  <input
                    className="input input-number"
                    type="number"
                    min="1"
                    value={item.booths}
                    onChange={(event) => updateDemand(item.id, "booths", event.target.value)}
                  />
                </div>
                <button className="button button-danger" onClick={() => removeDemand(item.id)}>
                  Eliminar
                </button>
              </div>
            ))}
          </div>

          <button className="button button-secondary" onClick={addDemand}>
            + Agregar intervalo
          </button>
        </section>

        {result.error && <div className="error">{result.error}</div>}

        {result.stats && (
          <section style={{ marginTop: 40 }}>
            <h2>Resultado</h2>

            <div className="stats">
              <div className="stat">
                <div className="stat-label">Demanda total</div>
                <div className="stat-value">{formatMinutes(result.stats.totalWork)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Objetivo por agente</div>
                <div className="stat-value">{result.stats.target.toFixed(1)} min</div>
              </div>
              <div className="stat">
                <div className="stat-label">Menor carga</div>
                <div className="stat-value">{formatMinutes(result.stats.minMinutes)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Diferencia mÃ¡xima</div>
                <div
                  className={`stat-value ${result.stats.difference <= 1 ? "good" : "warning"}`}
                >
                  {result.stats.difference} min
                </div>
              </div>
            </div>

            <div className="table-wrapper">
              <table className="schedule-table">
                <thead>
                  <tr>
                    <th>Agente</th>
                    <th>Total</th>
                    <th>Turnos</th>
                  </tr>
                </thead>
                <tbody>
                  {result.schedule.map((agent) => (
                    <tr key={agent.id}>
                      <td style={{ padding: 8, verticalAlign: "top" }}>
                        <strong>{agent.name}</strong>
                        <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                          ID {agent.id}
                        </div>
                      </td>
                      <td style={{ padding: 8, verticalAlign: "top" }}>
                        {formatMinutes(agent.minutes)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {agent.assignments.map((assignment, index) => (
                          <div key={index} className="assignment">
                            <span className="assignment-time">
                              {minutesToTime(assignment.start)} â†’ {minutesToTime(assignment.end)}
                            </span>
                            <span className="assignment-booth">Casilla {assignment.booth}</span>
                            {" â€” "}
                            <span>{assignment.minutes} min</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
