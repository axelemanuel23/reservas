// components/ClientPanel.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';

function ClientPanel() {
  const [canchas, setCanchas] = useState([]);
  const [selectedCancha, setSelectedCancha] = useState('');
  const [horarios, setHorarios] = useState([]);
  const [selectedHorario, setSelectedHorario] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');

  useEffect(() => {
    fetchCanchas();
  }, []);

  useEffect(() => {
    if (selectedCancha) {
      fetchHorarios();
    }
  }, [selectedCancha]);

  const fetchCanchas = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/v1/client/canchas');
      setCanchas(res.data);
    } catch (error) {
      console.error('Error fetching canchas:', error);
    }
  };

  const fetchHorarios = async () => {
    try {
      const res = await axios.get(`http://localhost:5000/api/v1/client/horarios/${selectedCancha}`);
      setHorarios(res.data);
    } catch (error) {
      console.error('Error fetching horarios:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:5000/api/v1/client/reservas', {
        horarioId: selectedHorario,
        nombre,
        telefono,
      });
      setSelectedHorario('');
      setNombre('');
      setTelefono('');
      alert('Reserva solicitada con éxito');
    } catch (error) {
      console.error('Error submitting reservation:', error);
      alert('Error al solicitar la reserva');
    }
  };

  return (
    <div className="bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4">
      <h2 className="text-2xl font-bold mb-4">Reserva de Cancha</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="cancha">
            Seleccione una cancha
          </label>
          <select 
            id="cancha"
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
        {selectedCancha && (
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="horario">
              Seleccione un horario
            </label>
            <select 
              id="horario"
              value={selectedHorario} 
              onChange={(e) => setSelectedHorario(e.target.value)}
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            >
              <option value="">Seleccione un horario</option>
              {horarios.map((horario) => (
                <option key={horario._id} value={horario._id}>
                  {new Date(horario.fecha).toLocaleDateString()} {horario.hora}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="nombre">
            Nombre
          </label>
          <input
            id="nombre"
            type="text"
            placeholder="Su nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
          />
        </div>
        <div className="mb-6">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="telefono">
            Teléfono
          </label>
          <input
            id="telefono"
            type="tel"
            placeholder="Su teléfono"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
          />
        </div>
        <div className="flex items-center justify-between">
          <button
            type="submit"
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Reservar
          </button>
        </div>
      </form>
    </div>
  );
}

export default ClientPanel;
