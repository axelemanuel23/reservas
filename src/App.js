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
  const safeMinutes = Math.round(minutes);

  const hours = Math.floor(
    safeMinutes / 60
  )
    .toString()
    .padStart(2, "0");

  const mins = (
    safeMinutes % 60
  )
    .toString()
    .padStart(2, "0");

  return `${hours}:${mins}`;
}


function getAgentTargets(agents, totalWork) {
  const baseTarget = Math.floor(
    totalWork / agents.length
  );

  const remainder =
    totalWork % agents.length;

  return agents.reduce(
    (targets, agent, index) => {
      targets[agent.id] =
        baseTarget +
        (index < remainder ? 1 : 0);

      return targets;
    },
    {}
  );
}

function getFutureCommittedMinutes(
  agent,
  demand,
  currentTime
) {
  return demand.reduce(
    (total, item) => {
      const start =
        timeToMinutes(item.start);

      const end =
        timeToMinutes(item.end);

      if (
        start <= currentTime ||
        item.booths < 2
      ) {
        return total;
      }

      /*
        Por ahora no asignamos todavía
        un agente concreto al bloque.

        La cantidad de trabajo futuro
        obligatorio para un agente será
        determinada por sus reservas.
      */

      if (
        agent.reservedFor === item.id
      ) {
        return (
          total +
          (end - start)
        );
      }

      return total;
    },
    0
  );
}


function getRemainingNeed(agent, targets) {
  return Math.max(
    0,
    targets[agent.id] - agent.minutes
  );
}

function selectAgentsForFixedBlock(
  agents,
  interval,
  targets
) {
  const start =
    timeToMinutes(interval.start);

  return [...agents]
    .filter(
      (agent) =>
        agent.availableAt <= start
    )
    .sort(
      (a, b) => {
        const aNeed =
          getRemainingNeed(
            a,
            targets
          );

        const bNeed =
          getRemainingNeed(
            b,
            targets
          );

        /*
          Primero elegimos a quienes
          todavía necesitan más minutos.
        */
        if (
          aNeed !== bNeed
        ) {
          return (
            bNeed - aNeed
          );
        }

        return a.id - b.id;
      }
    )
    .slice(
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
  currentTime,
  targets
) {
  const nextDemand =
    [...demand]
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
    timeToMinutes(
      nextDemand.start
    );

  const releaseDeadline =
    nextStart - TRAVEL_TIME;

  /*
    Si ya estamos dentro de la ventana
    de traslado, devolvemos solamente
    los agentes que ya estaban reservados.
  */
  if (
    currentTime >= releaseDeadline
  ) {
    return agents.filter(
      (agent) =>
        agent.reservedFor ===
        nextDemand.id
    );
  }

  const required =
    nextDemand.booths;

  /*
    Agentes ya reservados.
  */
  const alreadyReserved =
    agents.filter(
      (agent) =>
        agent.reservedFor ===
        nextDemand.id
    );

  /*
    Agentes disponibles para ser
    reservados.
  */
  const available =
    agents
      .filter(
        (agent) =>
          agent.reservedFor !==
            nextDemand.id &&
          agent.availableAt <=
            releaseDeadline
      )
      .sort(
        (a, b) => {
          /*
            Priorizamos al agente que
            tenga MENOR carga proyectada.

            La carga proyectada incluye
            lo que ya trabajó.
          */

          const aRemaining =
            getRemainingNeed(
              a,
              targets
            );

          const bRemaining =
            getRemainingNeed(
              b,
              targets
            );

          if (
            aRemaining !==
            bRemaining
          ) {
            return (
              bRemaining -
              aRemaining
            );
          }

          return a.id - b.id;
        }
      );

  const selected = [
    ...alreadyReserved,
    ...available,
  ].slice(
    0,
    required
  );

  selected.forEach(
    (agent) => {
      agent.reservedFor =
        nextDemand.id;
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
  targets
) {
  let current =
    timeToMinutes(
      interval.start
    );

  const end =
    timeToMinutes(
      interval.end
    );

  while (current < end) {
    /*
      --------------------------------------------------
      PRÓXIMA DEMANDA MULTI-CASILLA
      --------------------------------------------------
    */

    const nextDemand =
      getNextMultiBoothDemand(
        demand,
        current
      );

    let releaseDeadline =
      Infinity;

    if (nextDemand) {
      const nextStart =
        timeToMinutes(
          nextDemand.start
        );

      releaseDeadline =
        nextStart -
        TRAVEL_TIME;
    }

    /*
      --------------------------------------------------
      RESERVAS
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
          current,
          targets
        );
    }

    /*
      --------------------------------------------------
      CANDIDATOS
      --------------------------------------------------
    */

    let candidates =
      agents.filter(
        (agent) =>
          agent.availableAt <=
          current
      );

    /*
      Después del deadline,
      los reservados deben estar libres.
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
      SI NO HAY CANDIDATOS
      --------------------------------------------------
    */

    if (
      candidates.length === 0
    ) {
      if (
        releaseDeadline !==
          Infinity &&
        current <
          releaseDeadline
      ) {
        current =
          releaseDeadline;

        continue;
      }

      break;
    }

    /*
      --------------------------------------------------
      SELECCIÓN
      --------------------------------------------------

      Priorizamos al agente con
      mayor necesidad restante.

      Esto es importante:

      Si Pedro necesita 140
      y Juan/Marcos necesitan
      solamente 80 antes del
      bloque futuro, Pedro toma
      primero el tramo.
    */

    candidates.sort(
      (a, b) => {
        const aNeed =
          getRemainingNeed(
            a,
            targets
          );

        const bNeed =
          getRemainingNeed(
            b,
            targets
          );

        if (
          aNeed !== bNeed
        ) {
          return (
            bNeed - aNeed
          );
        }

        return a.id - b.id;
      }
    );

    const selected =
      candidates[0];

    /*
      --------------------------------------------------
      DURACIÓN MÁXIMA
      --------------------------------------------------
    */

    let duration =
      end - current;

    /*
      Nunca atravesamos el deadline.
    */

    if (
      releaseDeadline !==
        Infinity &&
      current <
        releaseDeadline
    ) {
      duration =
        Math.min(
          duration,
          releaseDeadline -
            current
        );
    }

    /*
      --------------------------------------------------
      NECESIDAD RESTANTE
      --------------------------------------------------
    */

    const remainingNeed =
      getRemainingNeed(
        selected,
        targets
      );

    /*
      Nunca damos más minutos
      de los que necesita.
    */

    duration =
      Math.min(
        duration,
        remainingNeed
      );

    /*
      --------------------------------------------------
      MINUTOS ENTEROS
      --------------------------------------------------
    */

    duration =
      Math.floor(duration);

    /*
      Si ya llegó a su objetivo,
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
              targets
            ) > 0
        );

      if (!alternative) {
        /*
          Nadie necesita más minutos
          dentro del objetivo.

          No seguimos cargando
          arbitrariamente al primero.
        */
        break;
      }

      /*
        Reintentamos inmediatamente
        con el siguiente agente.
      */

      const alternativeNeed =
        getRemainingNeed(
          alternative,
          targets
        );

      duration =
        Math.min(
          end - current,
          alternativeNeed
        );

      if (
        releaseDeadline !==
          Infinity
      ) {
        duration =
          Math.min(
            duration,
            releaseDeadline -
              current
          );
      }

      duration =
        Math.floor(duration);

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

      current += duration;

      continue;
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
  
  const targets =
  getAgentTargets(
    agents,
    totalWork
  );


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
    const selected =
      selectAgentsForFixedBlock(
        agents,
        interval,
        targets
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

        agent.reservedFor =
          null;
      }
    );
  } else {
    assignFlexibleInterval(
      agents,
      interval,
      sortedDemand,
      targets
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
