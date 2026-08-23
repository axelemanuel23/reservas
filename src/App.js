import { useMemo, useState } from "react";
import "./App.css"

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
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");

  const mins = (minutes % 60)
    .toString()
    .padStart(2, "0");

  return `${hours}:${mins}`;
}

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

  /*
    Si el nuevo turno es inmediatamente posterior
    y pertenece a la misma casilla, lo unimos.
  */

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

function selectAgentsForFixedBlock(
  agents,
  quantity,
  duration
) {
  /*
    Para una demanda de 2 o más casillas:

        00:00 → 01:00
        2 casillas

    elegimos 2 agentes y ambos hacen la hora completa.

    La prioridad es:
    1. Menor cantidad de minutos acumulados.
    2. ID como desempate estable.
  */

  return [...agents]
    .sort((a, b) => {
      if (a.minutes !== b.minutes) {
        return a.minutes - b.minutes;
      }

      return a.id - b.id;
    })
    .slice(0, quantity);
}

// =========================================================
// CALCULAR OBJETIVOS FINALES
// =========================================================

function calculateFinalTargets(
  agents,
  flexibleMinutes,
  totalWork
) {
  /*
    Tenemos las horas que ya fueron asignadas por
    bloques fijos.

    Ahora distribuimos los minutos flexibles intentando
    igualar la carga final.

    Ejemplo:

        A = 60
        B = 60
        C = 60
        D = 60
        E = 0

    Si quedan 240 minutos flexibles:

        E recibe 96
        A/B/C/D reciben 36

    Resultado:

        todos = 96
  */

  const targets = agents.map((agent) => ({
    id: agent.id,
    target: agent.minutes,
  }));

  let remaining = flexibleMinutes;

  while (remaining > 0) {
    targets.sort((a, b) => {
      if (a.target !== b.target) {
        return a.target - b.target;
      }

      return a.id - b.id;
    });

    targets[0].target += 1;
    remaining--;
  }

  return targets;
}

// =========================================================
// ASIGNAR INTERVALO DE UNA SOLA CASILLA
// =========================================================

function assignFlexibleInterval(
  agents,
  interval,
  targets
) {
  let current = timeToMinutes(interval.start);
  const end = timeToMinutes(interval.end);

  /*
    Esta función trabaja en minutos reales.

    NO utiliza slots de 5 minutos.

    Por eso puede producir:

        01:00 → 01:48
        01:48 → 02:36

    etc.
  */

  while (current < end) {
    const remainingInterval = end - current;

    /*
      Cuánto le falta a cada agente para llegar
      a su objetivo.
    */
    const currentTime = current;
    
    const candidates = agents
      .map((agent) => {
        const target =
          targets.find(
            (item) => item.id === agent.id
          ).target;

        return {
          agent,
          target,
          remaining:
            target - agent.minutes,
        };
      })
      .sort((a, b) => {
        /*
          Primero el que más necesita minutos.
        */

        if (a.remaining !== b.remaining) {
          return b.remaining - a.remaining;
        }

        /*
          Si están empatados, preferimos continuar
          con el mismo agente si estaba trabajando.
        */

        const aLast =
          a.agent.assignments[
            a.agent.assignments.length - 1
          ];

        const bLast =
          b.agent.assignments[
            b.agent.assignments.length - 1
          ];

        const aContinuity =
          aLast && aLast.end === currentTime ? 1 : 0;

        const bContinuity =
          bLast && bLast.end === currentTime ? 1 : 0;

        if (aContinuity !== bContinuity) {
          return bContinuity - aContinuity;
        }

        return a.agent.id - b.agent.id;
      });

    const selected = candidates[0];

    if (!selected) {
      break;
    }

    /*
      Si todos ya llegaron al objetivo, buscamos al que
      tenga menor carga para absorber el sobrante.
    */

    let duration;

    if (selected.remaining > 0) {
      duration = Math.min(
        selected.remaining,
        remainingInterval
      );
    } else {
      const lowest = [...agents].sort(
        (a, b) => a.minutes - b.minutes
      )[0];

      selected.agent = lowest;

      duration = remainingInterval;
    }

    if (duration <= 0) {
      break;
    }

    addAssignment(
      selected.agent,
      current,
      current + duration,
      1
    );

    selected.agent.minutes += duration;

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

  const agents = agentsInput.map((agent) => ({
    ...agent,
    minutes: 0,
    assignments: [],
  }));

  const sortedDemand = [...demand].sort(
    (a, b) =>
      timeToMinutes(a.start) -
      timeToMinutes(b.start)
  );

  const totalWork =
    calculateTotalWork(sortedDemand);

  /*
    -----------------------------------------------------
    PASO 1
    -----------------------------------------------------

    Asignamos primero los bloques de 2 o más casillas.

    Ejemplo:

        00–01 → 2
        05–06 → 3

    Estos bloques NO se dividen.
  */

  const fixedIntervals = sortedDemand.filter(
    (item) => item.booths >= 2
  );

  for (const interval of fixedIntervals) {
    const start = timeToMinutes(
      interval.start
    );

    const end = timeToMinutes(
      interval.end
    );

    const selected =
      selectAgentsForFixedBlock(
        agents,
        interval.booths,
        end - start
      );

    selected.forEach((agent, index) => {
      addAssignment(
        agent,
        start,
        end,
        index + 1
      );

      agent.minutes += end - start;
    });
  }

  /*
    -----------------------------------------------------
    PASO 2
    -----------------------------------------------------

    Calculamos cuánto tiempo queda en intervalos
    de una sola casilla.
  */

  const flexibleIntervals =
    sortedDemand.filter(
      (item) => item.booths === 1
    );

  const flexibleMinutes =
    flexibleIntervals.reduce(
      (total, interval) => {
        return (
          total +
          timeToMinutes(interval.end) -
          timeToMinutes(interval.start)
        );
      },
      0
    );

  /*
    -----------------------------------------------------
    PASO 3
    -----------------------------------------------------

    Calculamos el objetivo final de cada agente.

    Esto tiene en cuenta los bloques fijos que ya
    asignamos.
  */

  const targets = calculateFinalTargets(
    agents,
    flexibleMinutes,
    totalWork
  );

  /*
    -----------------------------------------------------
    PASO 4
    -----------------------------------------------------

    Ahora utilizamos las horas de una sola casilla
    como "espacio flexible" para igualar las cargas.

    Es aquí donde pueden aparecer minutos arbitrarios:

        48 min
        36 min
        17 min
        etc.
  */

  for (const interval of flexibleIntervals) {
    assignFlexibleInterval(
      agents,
      interval,
      targets
    );
  }

  /*
    -----------------------------------------------------
    RESULTADO
    -----------------------------------------------------
  */

  const loads = agents.map(
    (agent) => agent.minutes
  );

  const minMinutes = Math.min(...loads);
  const maxMinutes = Math.max(...loads);

  const target =
    totalWork / agents.length;

  return {
    error: null,

    schedule: agents,

    stats: {
      totalWork,
      target,
      minMinutes,
      maxMinutes,
      difference:
        maxMinutes - minMinutes,
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
        <header/>
      {/* ================================================= */}
      {/* AGENTES */}
      {/* ================================================= */}
    
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Agentes</h2>
            <p className="card-description">Personas disponibles para cubrir las casillas.</p>
          </div>

        {agents.map((agent) => (
          <div
            key={agent.id}
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <input
              value={agent.name}
              onChange={(event) =>
                updateAgent(
                  agent.id,
                  event.target.value
                )
              }
            />

            <button
              onClick={() =>
                removeAgent(agent.id)
              }
            >
              Eliminar
            </button>
          </div>
        ))}

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

        {demand.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <input
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

            <span>→</span>

            <input
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

            <label>
              Casillas:

              <input
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
                style={{
                  width: 60,
                  marginLeft: 5,
                }}
              />
            </label>

            <button
              onClick={() =>
                removeDemand(item.id)
              }
            >
              Eliminar
            </button>
          </div>
        ))}

        <button onClick={addDemand}>
          + Agregar intervalo
        </button>
      </section>

      {/* ================================================= */}
      {/* ERROR */}
      {/* ================================================= */}

      {result.error && (
        <div
          style={{
            marginTop: 30,
            padding: 15,
            background: "#ffe5e5",
            color: "#a00",
          }}
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(4, 1fr)",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                padding: 15,
                background: "#f5f5f5",
              }}
            >
              <strong>
                Demanda total
              </strong>

              <div>
                {formatMinutes(
                  result.stats.totalWork
                )}
              </div>
            </div>

            <div
              style={{
                padding: 15,
                background: "#f5f5f5",
              }}
            >
              <strong>
                Objetivo
              </strong>

              <div>
                {result.stats.target.toFixed(
                  1
                )}{" "}
                min
              </div>
            </div>

            <div
              style={{
                padding: 15,
                background: "#f5f5f5",
              }}
            >
              <strong>
                Menor carga
              </strong>

              <div>
                {formatMinutes(
                  result.stats.minMinutes
                )}
              </div>
            </div>

            <div
              style={{
                padding: 15,
                background: "#f5f5f5",
              }}
            >
              <strong>
                Diferencia
              </strong>

              <div>
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
                            style={{
                              marginBottom: 4,
                            }}
                          >
                            {minutesToTime(
                              assignment.start
                            )}
                            {" → "}
                            {minutesToTime(
                              assignment.end
                            )}

                            {" — Casilla "}
                            {assignment.booth}

                            {" — "}

                            {
                              assignment.minutes
                            }{" "}
                            min
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
