// components/AdminPanel.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import CanchaForm from './CanchaForm';
import HorarioForm from './HorarioForm';
import ReservasList from './ReservasList';

function AdminPanel() {
  const [canchas, setCanchas] = useState([]);
  const [selectedCancha, setSelectedCancha] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [reservas, setReservas] = useState([]);

  useEffect(() => {
    fetchCanchas();
  }, []);

  const fetchCanchas = async () => {
    const res = await axios.get('http://localhost:5000/api/v1/admin/canchas');
    setCanchas(res.data);
  };

  const fetchReservas = async () => {
    if (selectedCancha && selectedDate) {
      const res = await axios.get(`http://localhost:5000/api/v1/admin/reservas/${selectedCancha}/${selectedDate}`);
      setReservas(res.data);
    }
  };

  const handleReserva = async (id, estado) => {
    await axios.put(`http://localhost:5000/api/v1/admin/reservas/${id}`, { estado });
    fetchReservas();
  };

  return (
    <div className="bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4">
      <h2 className="text-2xl font-bold mb-4">Panel de Administrador</h2>
      
      <CanchaForm onCanchaAdded={fetchCanchas} />

      <div className="mb-4">
        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="cancha-select">
          Seleccionar Cancha
        </label>
        <select
          id="cancha-select"
          value={selectedCancha}
          onChange={(e) => setSelectedCancha(e.target.value)}
          className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
        >
          <option value="">Seleccione una cancha</option>
          {canchas.map((cancha) => (
            <option key={cancha._id} value={cancha._id}>{cancha.nombre}</option>
          ))}
        </select>
      </div>
      {/**Cuando se selecciona una cancha la variable es verdadera y despliega */}
      {selectedCancha && (
        <>
          <HorarioForm canchaId={selectedCancha} />

          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="date-select">
              Seleccionar Fecha para Ver Reservas
            </label>
            <input
              id="date-select"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            />
          </div>
          <button 
            onClick={fetchReservas}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline mb-4"
          >
            Ver Reservas
          </button>

          <ReservasList reservas={reservas} onReservaUpdate={handleReserva} selectedDate={selectedDate}/>
        </>
      )}
    </div>
  );
}


export default AdminPanel