import { useMemo, useState } from "react";
import "./App.css";

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

function timeToMinutes(time) {
  const [hours, minutes] = time
    .split(":")
    .map(Number);

  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const safeMinutes = Math.round(minutes);

  const hours = Math.floor(safeMinutes / 60)
    .toString()
    .padStart(2, "0");

  const mins = (safeMinutes % 60)
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

  if (demand.length === 0) {
    return "Debe existir al menos un intervalo de demanda.";
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

  /*
   * Los intervalos representan demanda absoluta.
   * Por eso no permitimos superposición.
   */

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
// CALCULAR DEMANDA TOTAL
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
   * Si el nuevo bloque es inmediatamente
   * posterior al anterior y corresponde
   * a la misma casilla, los unificamos.
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
// SELECCIONAR AGENTES
// =========================================================

function selectAgentsForInterval(
  agents,
  booths
) {
  /*
   * Elegimos los agentes que tienen
   * menos minutos acumulados.
   *
   * En caso de empate utilizamos el ID
   * para mantener un resultado estable.
   */

  return [...agents]
    .sort((a, b) => {
      if (a.minutes !== b.minutes) {
        return a.minutes - b.minutes;
      }

      return a.id - b.id;
    })
    .slice(0, booths);
}

// =========================================================
// GENERADOR PRINCIPAL
// =========================================================

function generateSchedule(
  agentsInput,
  demand
) {
  // -------------------------------------------------------
  // VALIDACIÓN
  // -------------------------------------------------------

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

  // -------------------------------------------------------
  // CREAR ESTADO INTERNO DE LOS AGENTES
  // -------------------------------------------------------

  const agents = agentsInput.map(
    (agent) => ({
      ...agent,
      minutes: 0,
      assignments: [],
    })
  );

  // -------------------------------------------------------
  // ORDENAR DEMANDA CRONOLÓGICAMENTE
  // -------------------------------------------------------

  const sortedDemand = [...demand].sort(
    (a, b) =>
      timeToMinutes(a.start) -
      timeToMinutes(b.start)
  );

  // -------------------------------------------------------
  // CALCULAR DEMANDA TOTAL
  // -------------------------------------------------------

  const totalWork =
    calculateTotalWork(
      sortedDemand
    );

  // -------------------------------------------------------
  // ASIGNACIÓN
  // -------------------------------------------------------

  for (const interval of sortedDemand) {
    const start =
      timeToMinutes(
        interval.start
      );

    const end =
      timeToMinutes(
        interval.end
      );

    const duration =
      end - start;

    /*
     * Seleccionamos tantos agentes
     * como casillas tenga el intervalo.
     *
     * Siempre elegimos primero
     * a los agentes con menor carga.
     */

    const selectedAgents =
      selectAgentsForInterval(
        agents,
        interval.booths
      );

    selectedAgents.forEach(
      (agent, index) => {
        addAssignment(
          agent,
          start,
          end,
          index + 1
        );

        agent.minutes +=
          duration;
      }
    );
  }

  // -------------------------------------------------------
  // ESTADÍSTICAS
  // -------------------------------------------------------

  const loads =
    agents.map(
      (agent) => agent.minutes
    );

  const minMinutes =
    Math.min(...loads);

  const maxMinutes =
    Math.max(...loads);

  const target =
    totalWork / agents.length;

  const difference =
    maxMinutes - minMinutes;

  // -------------------------------------------------------
  // RESULTADO
  // -------------------------------------------------------

  return {
    error: null,

    schedule: agents,

    stats: {
      totalWork,
      target,
      minMinutes,
      maxMinutes,
      difference,
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

  // =======================================================
  // AGENTES
  // =======================================================

  function addAgent() {
    const nextId =
      Math.max(
        0,
        ...agents.map(
          (agent) => agent.id
        )
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

  function updateAgent(
    id,
    name
  ) {
    setAgents(
      agents.map((agent) =>
        agent.id === id
          ? {
              ...agent,
              name,
            }
          : agent
      )
    );
  }

  // =======================================================
  // DEMANDA
  // =======================================================

  function addDemand() {
    const nextId =
      Math.max(
        0,
        ...demand.map(
          (item) => item.id
        )
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

  // =======================================================
  // RENDER
  // =======================================================

  return (
    <div className="app">
      <div className="container">

        {/* ================================================= */}
        {/* HEADER */}
        {/* ================================================= */}

        <header className="header">
          <h1>
            Gestión de horarios
          </h1>

          <p>
            Distribución automática de
            agentes y casillas
          </p>
        </header>

        {/* ================================================= */}
        {/* AGENTES */}
        {/* ================================================= */}

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Agentes
              </h2>

              <p className="card-description">
                Personas disponibles para
                cubrir las casillas.
              </p>
            </div>

            <div className="agent-list">
              {agents.map(
                (agent) => (
                  <div
                    key={agent.id}
                    className="agent-row"
                  >
                    <div className="agent-number">
                      {agent.id}
                    </div>

                    <input
                      className="input input-name"
                      value={
                        agent.name
                      }
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
                        removeAgent(
                          agent.id
                        )
                      }
                    >
                      Eliminar
                    </button>
                  </div>
                )
              )}
            </div>

            <button
              className="button button-primary"
              onClick={addAgent}
            >
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
            Cada intervalo representa la
            cantidad de casillas que deben
            estar cubiertas simultáneamente.
          </p>

          <div className="demand-list">
            {demand.map(
              (item) => (
                <div
                  key={item.id}
                  className="demand-row"
                >
                  <input
                    className="input input-time"
                    type="time"
                    value={
                      item.start
                    }
                    onChange={(
                      event
                    ) =>
                      updateDemand(
                        item.id,
                        "start",
                        event.target.value
                      )
                    }
                  />

                  <span className="time-arrow">
                    →
                  </span>

                  <input
                    className="input input-time"
                    type="time"
                    value={
                      item.end
                    }
                    onChange={(
                      event
                    ) =>
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
                      value={
                        item.booths
                      }
                      onChange={(
                        event
                      ) =>
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
                      removeDemand(
                        item.id
                      )
                    }
                  >
                    Eliminar
                  </button>
                </div>
              )
            )}
          </div>

          <button
            className="button button-secondary"
            onClick={addDemand}
          >
            + Agregar intervalo
          </button>
        </section>

        {/* ================================================= */}
        {/* ERROR */}
        {/* ================================================= */}

        {result.error && (
          <div className="error">
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
            <h2>
              Resultado
            </h2>

            {/* ============================================= */}
            {/* ESTADÍSTICAS */}
            {/* ============================================= */}

            <div className="stats">
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

                <div className="stat-value">
                  {formatMinutes(
                    result.stats.minMinutes
                  )}
                </div>
              </div>

              <div className="stat">
                <div className="stat-label">
                  Diferencia Máxima
                </div>

                <div
                  className={`stat-value ${
                    result.stats.difference <=
                    1
                      ? "good"
                      : "warning"
                  }`}
                >
                  {
                    result.stats
                      .difference
                  }{" "}
                  min
                </div>
              </div>
            </div>

            {/* ============================================= */}
            {/* TABLA */}
            {/* ============================================= */}

            <div className="table-wrapper">
              <table className="schedule-table">
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign:
                          "left",
                        padding: 8,
                        borderBottom:
                          "1px solid #ccc",
                      }}
                    >
                      Agente
                    </th>

                    <th
                      style={{
                        textAlign:
                          "left",
                        padding: 8,
                        borderBottom:
                          "1px solid #ccc",
                      }}
                    >
                      Total
                    </th>

                    <th
                      style={{
                        textAlign:
                          "left",
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
                      <tr
                        key={
                          agent.id
                        }
                      >
                        <td
                          style={{
                            padding: 8,
                            verticalAlign:
                              "top",
                          }}
                        >
                          <strong>
                            {
                              agent.name
                            }
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
                                key={
                                  index
                                }
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
                                  Casilla{" "}
                                  {
                                    assignment.booth
                                  }
                                </span>

                                {" — "}

                                <span>
                                  {
                                    assignment.minutes
                                  }{" "}
                                  min
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
