import React from 'react';

function ReservasList({ reservas, onReservaUpdate, selectedDate }) {
  // Separate pending and accepted reservations
  const pendingReservas = reservas.filter(reserva => reserva.estado === 'pendiente');
  const acceptedReservas = reservas.filter(reserva => reserva.estado === 'aceptada');

  return (
    <div>
      <h3 className="text-xl font-bold mb-2">Reservas</h3>
      <ul>
        {/* Display pending reservations first */}
        {pendingReservas.map((reserva) => (
          <li key={reserva._id} className="mb-2 p-2 border rounded">
            <p>{reserva.nombre} - {reserva.telefono}</p>
            <p>{new Date(reserva.horario.fecha).toLocaleDateString()} {reserva.horario.hora}</p>
            <p>Estado: {reserva.estado}</p>
            <div className="mt-2">
              <button 
                onClick={() => onReservaUpdate(reserva._id, 'aceptada')}
                className="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded mr-2"
              >
                Aceptar
              </button>
              <button 
                onClick={() => onReservaUpdate(reserva._id, 'rechazada')}
                className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-2 rounded"
              >
                Rechazar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Display accepted reservations if a date is selected */}
      {selectedDate && (
        <>
          <h3 className="text-xl font-bold mb-2 mt-4">Reservas Aceptadas</h3>
          <ul>
            {acceptedReservas.map((reserva) => (
              <li key={reserva._id} className="mb-2 p-2 border rounded">
                <p>{reserva.nombre} - {reserva.telefono}</p>
                <p>{new Date(reserva.horario.fecha).toLocaleDateString()} {reserva.horario.hora}</p>
                <p>Estado: {reserva.estado}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default ReservasList;
