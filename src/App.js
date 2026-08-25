import { useMemo, useState } from "react";
import './App.css';

const INITIAL_AGENTS = [
  { id: 1, name: "Pedro" },
  { id: 2, name: "Juan" },
  { id: 3, name: "Marcos" },
];

const INITIAL_DEMAND = [
  {
    id: 1,
    start: "03:30",
    end: "05:00",
    booths: 1,
  },
  {
    id: 2,
    start: "05:00",
    end: "06:00",
    booths: 2,
  },
];

// =========================================================
// UTILIDADES
// =========================================================
const TRAVEL_TIME = 30;

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins} min`;
  }

  return `${hours}h ${mins}m`;
}

// =========================================================
// VALIDAR DEMANDA
// =========================================================

function validateDemand(agents, demand) {
  if (agents.length === 0) {
    return "Debe existir al menos un agente.";
  }

  for (const item of demand) {
    const start = timeToMinutes(item.start);
    const end = timeToMinutes(item.end);

    if (start >= end) {
      return `Horario inválido: ${item.start} → ${item.end}`;
    }

    if (item.booths < 1) {
      return "La cantidad de casillas debe ser mayor a 0.";
    }

    if (item.booths > agents.length) {
      return (
        `El intervalo ${item.start} → ${item.end} ` +
        `requiere ${item.booths} casillas pero solo hay ` +
        `${agents.length} agentes.`
      );
    }
  }

  // Los intervalos representan demanda absoluta,
  // por lo tanto no permitimos superposición.
  const sorted = [...demand].sort(
    (a, b) =>
      timeToMinutes(a.start) -
      timeToMinutes(b.start)
  );

  for (let i = 1; i < sorted.length; i++) {
    const previousEnd = timeToMinutes(
      sorted[i - 1].end
    );

    const currentStart = timeToMinutes(
      sorted[i].start
    );

    if (currentStart < previousEnd) {
      return (
        `Hay intervalos superpuestos: ` +
        `${sorted[i - 1].start} → ${sorted[i - 1].end} ` +
        `y ${sorted[i].start} → ${sorted[i].end}`
      );
    }
  }

  return null;
}

// =========================================================
// CARGA TOTAL
// =========================================================

function calculateTotalWork(demand) {
  return demand.reduce((total, item) => {
    const duration =
      timeToMinutes(item.end) -
      timeToMinutes(item.start);

    return total + duration * item.booths;
  }, 0);
}

// =========================================================
// AGREGAR ASIGNACIÓN
// =========================================================
function addAssignment(
  agent,
  start,
  end,
  booth
) {
  const last =
    agent.assignments[
      agent.assignments.length - 1
    ];

  if (
    last &&
    last.end === start &&
    last.booth === booth
  ) {
    last.end = end;
    last.minutes += end - start;
    return;
  }

  agent.assignments.push({
    start,
    end,
    booth,
    minutes: end - start,
  });
}


// =========================================================
// SELECCIONAR AGENTES PARA UN BLOQUE FIJO
// =========================================================

function timeToMinutes(time) {
  const [hours, minutes] =
    time.split(":").map(Number);

  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");

  const mins = (minutes % 60)
    .toString()
    .padStart(2, "0");

  return `${hours}:${mins}`;
}

function getRemainingNeed(
  agent,
  agents,
  totalWork
) {
  const target =
    totalWork / agents.length;

  return target - agent.minutes;
}

function selectAgentsForFixedBlock(
  agents,
  interval
) {
  /*
    Primero usamos los agentes que fueron
    reservados específicamente para este bloque.
  */

  const reserved =
    agents.filter(
      (agent) =>
        agent.reservedFor ===
        interval.id
    );

  /*
    Si no alcanza la reserva, completamos
    con agentes disponibles.
  */

  const available =
    agents
      .filter(
        (agent) =>
          !reserved.includes(agent) &&
          agent.availableAt <=
            timeToMinutes(interval.start)
      )
      .sort(
        (a, b) =>
          a.id - b.id
      );

  return [
    ...reserved,
    ...available,
  ].slice(
    0,
    interval.booths
  );
}


// =========================================================
// ASIGNAR INTERVALO DE UNA SOLA CASILLA
// =========================================================

function selectReservedAgents(
  agents,
  demand,
  currentTime
) {
  const nextDemand = [...demand]
    .filter(
      (item) =>
        timeToMinutes(item.start) >
          currentTime &&
        item.booths >= 2
    )
    .sort(
      (a, b) =>
        timeToMinutes(a.start) -
        timeToMinutes(b.start)
    )[0];

  if (!nextDemand) {
    return [];
  }

  const nextStart =
    timeToMinutes(nextDemand.start);

  const releaseDeadline =
    nextStart - TRAVEL_TIME;

  /*
    Si ya estamos dentro de la ventana
    de traslado, no hacemos nuevas reservas.
  */
  if (currentTime >= releaseDeadline) {
    return agents.filter(
      (agent) =>
        agent.reservedFor ===
        nextDemand.id
    );
  }

  const required =
    nextDemand.booths;

  /*
    Primero conservamos los agentes
    que ya estaban reservados.
  */
  const alreadyReserved =
    agents.filter(
      (agent) =>
        agent.reservedFor ===
        nextDemand.id
    );

  /*
    Completamos la reserva si todavía
    faltan agentes.
  */
  const remaining =
    agents
      .filter(
        (agent) =>
          agent.reservedFor !==
            nextDemand.id &&
          agent.availableAt <=
            releaseDeadline
      )
      .sort(
        (a, b) =>
          a.id - b.id
      );

  const selected = [
    ...alreadyReserved,
    ...remaining,
  ].slice(
    0,
    required
  );

  /*
    Marcamos explícitamente a estos agentes
    como necesarios para la próxima demanda.
  */
  selected.forEach(
  (agent, index) => {
    addAssignment(
      agent,
      start,
      end,
      index + 1
    );

    agent.minutes +=
      end - start;

    agent.availableAt =
      end;

    agent.reservedFor =
      null;
  }
);


  return selected;
}

function getNextMultiBoothDemand(
  demand,
  currentTime
) {
  return [...demand]
    .filter(
      (item) =>
        timeToMinutes(item.start) >
          currentTime &&
        item.booths >= 2
    )
    .sort(
      (a, b) =>
        timeToMinutes(a.start) -
        timeToMinutes(b.start)
    )[0] || null;
}

function assignFlexibleInterval(
  agents,
  interval,
  demand,
  totalWork
) {
  let current =
    timeToMinutes(interval.start);

  const end =
    timeToMinutes(interval.end);

  while (current < end) {
    /*
      --------------------------------------------------
      PRÓXIMA DEMANDA DE MÚLTIPLES CASILLAS
      --------------------------------------------------
    */

    const nextDemand =
      getNextMultiBoothDemand(
        demand,
        current
      );

    let releaseDeadline = Infinity;

    if (nextDemand) {
      const nextStart =
        timeToMinutes(
          nextDemand.start
        );

      releaseDeadline =
        nextStart - TRAVEL_TIME;
    }

    /*
      --------------------------------------------------
      FINAL DEL TRAMO
      --------------------------------------------------

      Si tenemos que liberar agentes a las
      04:30, nunca asignamos un turno que
      atraviese las 04:30.
    */

    /*
      --------------------------------------------------
      AGENTES QUE DEBEN ESTAR RESERVADOS
      --------------------------------------------------
    */

    let reservedAgents = [];

    if (
      nextDemand &&
      current < releaseDeadline
    ) {
      reservedAgents =
        selectReservedAgents(
          agents,
          demand,
          current
        );
    }

    /*
      --------------------------------------------------
      CANDIDATOS
      --------------------------------------------------

      IMPORTANTE:

      Antes del deadline pueden trabajar
      TODOS los agentes.

      Los reservados simplemente NO pueden
      quedar ocupados después del deadline.

      Esto permite:

          Pedro 03:30 → 04:00
          Juan  04:00 → 04:30
          Marcos 04:30 → 05:00
    */

    let candidates =
      agents.filter(
        (agent) =>
          agent.availableAt <= current
      );

    /*
      --------------------------------------------------
      SI ESTAMOS ANTES DEL DEADLINE
      --------------------------------------------------

      Todos pueden trabajar.

      Pero priorizamos agentes que NO están
      reservados solamente si eso ayuda a
      repartir la carga.

      FIFO sigue siendo la prioridad principal.
    */

    if (
      current < releaseDeadline &&
      reservedAgents.length > 0
    ) {
      const nonReserved =
        candidates.filter(
          (agent) =>
            !reservedAgents.includes(
              agent
            )
        );

      const reserved =
        candidates.filter(
          (agent) =>
            reservedAgents.includes(
              agent
            )
        );

      /*
        Primero los agentes no reservados.

        Así evitamos gastar demasiado tiempo
        de quienes necesitan trasladarse.
      */

      candidates = [
        ...nonReserved,
        ...reserved,
      ];
    }

    /*
      --------------------------------------------------
      DESPUÉS DEL DEADLINE
      --------------------------------------------------

      Los agentes reservados ya deben
      estar libres para trasladarse.
    */

    if (
      current >= releaseDeadline &&
      reservedAgents.length > 0
    ) {
      candidates =
        candidates.filter(
          (agent) =>
            !reservedAgents.includes(
              agent
            )
        );
    }

    /*
      --------------------------------------------------
      NO HAY CANDIDATOS
      --------------------------------------------------
    */

    if (
      candidates.length === 0
    ) {
      /*
        Si no podemos seguir trabajando
        en este tramo, avanzamos al deadline.
      */

      if (
        releaseDeadline !== Infinity &&
        current < releaseDeadline
      ) {
        current =
          releaseDeadline;

        continue;
      }

      break;
    }

    /*
      --------------------------------------------------
      ORDEN FIFO
      --------------------------------------------------

      Este es el criterio principal.

      El agente que fue cargado primero
      tiene prioridad.
    */

    candidates.sort(
      (a, b) =>
        a.id - b.id
    );

    /*
      --------------------------------------------------
      SELECCIONAR AGENTE
      --------------------------------------------------
    */

    const selected =
      candidates[0];

    /*
      --------------------------------------------------
      DURACIÓN
      --------------------------------------------------

      El agente puede trabajar hasta:

      1. el final del intervalo
      2. el deadline de traslado
      3. su objetivo restante
    */

    let duration =
      end - current;

    if (
      releaseDeadline !== Infinity &&
      current < releaseDeadline
    ) {
      duration =
        Math.min(
          duration,
          releaseDeadline - current
        );
    }

    /*
      --------------------------------------------------
      BALANCE DE CARGA
      --------------------------------------------------

      El balance NO domina FIFO.

      Solo evitamos darle tiempo a un agente
      que ya está por encima del objetivo
      cuando hay otros disponibles.
    */

    const remainingNeed =
      getRemainingNeed(
        selected,
        agents,
        totalWork
      );

    if (
      remainingNeed > 0
    ) {
      duration =
        Math.min(
          duration,
          remainingNeed
        );
    }

    /*
      Si el agente ya alcanzó su objetivo,
      buscamos otro.
    */

    if (
      duration <= 0
    ) {
      const alternative =
        candidates.find(
          (agent) =>
            getRemainingNeed(
              agent,
              agents,
              totalWork
            ) > 0
        );

      if (!alternative) {
        /*
          Todos alcanzaron el objetivo.
          Usamos FIFO igualmente.
        */

        duration =
          Math.min(
            end - current,
            releaseDeadline -
              current
          );

        if (
          !Number.isFinite(
            duration
          )
        ) {
          duration =
            end - current;
        }

        if (duration <= 0) {
          break;
        }
      } else {
        /*
          Cambiamos al siguiente agente.
        */

        const alternativeNeed =
          getRemainingNeed(
            alternative,
            agents,
            totalWork
          );

        duration =
          Math.min(
            duration,
            alternativeNeed
          );

        if (
          duration <= 0
        ) {
          break;
        }

        addAssignment(
          alternative,
          current,
          current + duration,
          1
        );

        alternative.minutes +=
          duration;

        alternative.availableAt =
          current + duration;

        current +=
          duration;

        continue;
      }
    }

    /*
      --------------------------------------------------
      ASIGNAR
      --------------------------------------------------
    */

    addAssignment(
      selected,
      current,
      current + duration,
      1
    );

    selected.minutes +=
      duration;

    selected.availableAt =
      current + duration;

    current += duration;
  }
}

// =========================================================
// GENERADOR PRINCIPAL
// =========================================================

function generateSchedule(
  agentsInput,
  demand
) {
  const error = validateDemand(
    agentsInput,
    demand
  );

  if (error) {
    return {
      error,
      schedule: [],
      stats: null,
    };
  }

  const agents = agentsInput.map(
  (agent) => ({
    ...agent,
    minutes: 0,
    assignments: [],
    availableAt: 0,
    reservedFor: null,
  })
);


  const sortedDemand = [...demand].sort(
    (a, b) =>
      timeToMinutes(a.start) -
      timeToMinutes(b.start)
  );

  const totalWork =
    calculateTotalWork(sortedDemand);

  /*
    -----------------------------------------------------
    ASIGNACIÓN CRONOLÓGICA
    -----------------------------------------------------

    Ahora procesamos TODOS los intervalos
    en orden temporal.

    Esto es importante porque el algoritmo
    necesita conocer las demandas futuras.
  */

for (const interval of sortedDemand) {
  const start =
    timeToMinutes(interval.start);

  const end =
    timeToMinutes(interval.end);

  if (interval.booths >= 2) {
    const selected =selectAgentsForFixedBlock(
        agents,
        interval
      );

    selected.forEach(
      (agent, index) => {
        addAssignment(
          agent,
          start,
          end,
          index + 1
        );

        agent.minutes +=
          end - start;

        agent.availableAt =
          end;
      }
    );
  } else {
    assignFlexibleInterval(
      agents,
      interval,
      sortedDemand,
      totalWork
    );
  }
}

  /*
    -----------------------------------------------------
    OBJETIVO FINAL
    -----------------------------------------------------
  */

  const target =
    totalWork /
    agents.length;

  /*
    -----------------------------------------------------
    RESULTADO
    -----------------------------------------------------
  */

  const loads =
    agents.map(
      (agent) => agent.minutes
    );

  const minMinutes =
    Math.min(...loads);

  const maxMinutes =
    Math.max(...loads);

  return {
    error: null,

    schedule: agents,

    stats: {
      totalWork,
      target,
      minMinutes,
      maxMinutes,
      difference:
        maxMinutes -
        minMinutes,
    },
  };
}


// =========================================================
// COMPONENTE REACT
// =========================================================

export default function App() {
  const [agents, setAgents] =
    useState(INITIAL_AGENTS);

  const [demand, setDemand] =
    useState(INITIAL_DEMAND);

  const result = useMemo(() => {
    return generateSchedule(
      agents,
      demand
    );
  }, [agents, demand]);

  // -------------------------------------------------------
  // AGENTES
  // -------------------------------------------------------

  function addAgent() {
    const nextId =
      Math.max(
        0,
        ...agents.map((agent) => agent.id)
      ) + 1;

    setAgents([
      ...agents,
      {
        id: nextId,
        name: `Agente ${nextId}`,
      },
    ]);
  }

  function removeAgent(id) {
    setAgents(
      agents.filter(
        (agent) => agent.id !== id
      )
    );
  }

  function updateAgent(id, name) {
    setAgents(
      agents.map((agent) =>
        agent.id === id
          ? { ...agent, name }
          : agent
      )
    );
  }

  // -------------------------------------------------------
  // DEMANDA
  // -------------------------------------------------------

  function addDemand() {
    const nextId =
      Math.max(
        0,
        ...demand.map((item) => item.id)
      ) + 1;

    setDemand([
      ...demand,
      {
        id: nextId,
        start: "00:00",
        end: "01:00",
        booths: 1,
      },
    ]);
  }

  function removeDemand(id) {
    setDemand(
      demand.filter(
        (item) => item.id !== id
      )
    );
  }

  function updateDemand(
    id,
    field,
    value
  ) {
    setDemand(
      demand.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]:
                field === "booths"
                  ? Number(value)
                  : value,
            }
          : item
      )
    );
  }

  // -------------------------------------------------------
  // RENDER
  // -------------------------------------------------------

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>Gestión de horarios</h1>
          <p>Distribución automática de agentes y casillas</p>
    </header>
      {/* ================================================= */}
      {/* AGENTES */}
      {/* ================================================= */}
    
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Agentes</h2>
            <p className="card-description">Personas disponibles para cubrir las casillas.</p>
          </div>
        <div className="agent-list">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="agent-row"
          >
              <div className="agent-number">
                {agent.id}
              </div>
            <input
              className="input input-name"
              value={agent.name}
              onChange={(event) =>
                updateAgent(
                  agent.id,
                  event.target.value
                )
              }
            />

            <button
              className="button button-danger"
              onClick={() =>
                removeAgent(agent.id)
              }
            >
              Eliminar
            </button>
          </div>
        ))}
        </div>

        <button 
          className="button button-primary"
          onClick={addAgent}>
          + Agregar agente
        </button>
        </div>
      </section>

      {/* ================================================= */}
      {/* DEMANDA */}
      {/* ================================================= */}

      <section
        style={{
          marginTop: 40,
        }}
      >
        <h2>
          Horarios de casillas
        </h2>

        <p>
          Los intervalos de 2 o más casillas
          se consideran bloques completos.
          Los intervalos de una sola casilla
          se utilizan para equilibrar las horas.
        </p>
        <div className="demand-list">
        {demand.map((item) => (
          <div
            key={item.id}
            className="demand-row"
          >
            <input
              className="input input-time"
              type="time"
              value={item.start}
              onChange={(event) =>
                updateDemand(
                  item.id,
                  "start",
                  event.target.value
                )
              }
            />

            <span className="time-arrow">→</span>

            <input
              className="input input-time"
              type="time"
              value={item.end}
              onChange={(event) =>
                updateDemand(
                  item.id,
                  "end",
                  event.target.value
                )
              }
            />

            <div className="field">
                <span className="field-label">
                  Casillas:
                </span>

              <input
                className="input input-number"
                type="number"
                min="1"
                value={item.booths}
                onChange={(event) =>
                  updateDemand(
                    item.id,
                    "booths",
                    event.target.value
                  )
                }
              />
            </div>

            <button
              className="button button-danger"
              onClick={() =>
                removeDemand(item.id)
              }
            >
              Eliminar
            </button>
          </div>
        ))}
        </div>

        <button
          className="button button-secondary"
          onClick={addDemand}>
          + Agregar intervalo
        </button>
      </section>

      {/* ================================================= */}
      {/* ERROR */}
      {/* ================================================= */}

      {result.error && (
        <div
          className="error"
        >
          {result.error}
        </div>
      )}

      {/* ================================================= */}
      {/* RESULTADO */}
      {/* ================================================= */}

      {result.stats && (
        <section
          style={{
            marginTop: 40,
          }}
        >
          <h2>Resultado</h2>

          <div className="stats" >
            <div className="stat">
              <div className="stat-label">
                Demanda total
              </div>

              <div className="stat-value">
                {formatMinutes(
                  result.stats.totalWork
                )}
              </div>
            </div>

            <div className="stat">
              <div className="stat-label">
                Objetivo por agente
              </div>

              <div className="stat-value">
                {result.stats.target.toFixed(
                  1
                )}{" "}
                min
              </div>
            </div>

            <div className="stat">
              <div className="stat-label">
                Menor carga
              </div>

              <div className="stat-value" >
                {formatMinutes(
                  result.stats.minMinutes
                )}
              </div>
            </div>

            <div className="stat">
              <div className="stat-label">
                Diferencia Máxima
              </div>

              <div className={`stat-value ${
                result.stats.difference <= 1
                ? "good"
                : "warning"
                }`}>
                {result.stats.difference} min
              </div>
            </div>
          </div>

          {/* ================================================= */}
          {/* TABLA */}
          {/* ================================================= */}
          <div className="table-wrapper">
          <table className="schedule-table">
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderBottom:
                      "1px solid #ccc",
                  }}
                >
                  Agente
                </th>

                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderBottom:
                      "1px solid #ccc",
                  }}
                >
                  Total
                </th>

                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderBottom:
                      "1px solid #ccc",
                  }}
                >
                  Turnos
                </th>
              </tr>
            </thead>

            <tbody>
              {result.schedule.map(
                (agent) => (
                  <tr key={agent.id}>
                    <td
                      style={{
                        padding: 8,
                        verticalAlign:
                          "top",
                      }}
                    >
                      <strong>
                        {agent.name}
                      </strong>
                    </td>

                    <td
                      style={{
                        padding: 8,
                        verticalAlign:
                          "top",
                      }}
                    >
                      {formatMinutes(
                        agent.minutes
                      )}
                    </td>

                    <td
                      style={{
                        padding: 8,
                      }}
                    >
                      {agent.assignments.map(
                        (
                          assignment,
                          index
                        ) => (
                          <div
                            key={index}
                            className="assignment"
                          >
                            <span className="assignment-time">
                            {minutesToTime(
                              assignment.start
                            )}
                            {" → "}
                            {minutesToTime(
                              assignment.end
                            )}
                            </span>
                            <span className="assignment-booth">
                            Casilla {assignment.booth}
                            </span>
                            {" — "}

                            <span>
                            {assignment.minutes} min
                            </span>
                          </div>
                        )
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          </div>
        </section>
      )}
    </div>
    </div>
  );
}
