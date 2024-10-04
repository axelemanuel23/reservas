// components/HorarioForm.js
import React, { useState } from 'react';
import axios from 'axios';

function HorarioForm({ canchaId }) {
  const [newHorario, setNewHorario] = useState({ fecha: '', hora: '' });

  const addHorario = async (e) => {
    e.preventDefault();
    await axios.post('http://localhost:5000/api/v1/admin/horarios', {
      ...newHorario,
      canchaId
    });
    setNewHorario({ fecha: '', hora: '' });
  };

  return (
    <form onSubmit={addHorario} className="mb-6">
      <h3 className="text-xl font-bold mb-2">Agregar Horario</h3>
      <div className="mb-4">
        <input
          type="date"
          value={newHorario.fecha}
          onChange={(e) => setNewHorario({ ...newHorario, fecha: e.target.value })}
          className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
        />
      </div>
      <div className="mb-4">
        <input
          type="time"
          value={newHorario.hora}
          onChange={(e) => setNewHorario({ ...newHorario, hora: e.target.value })}
          className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
        />
      </div>
      <button type="submit" className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline">
        Agregar Horario
      </button>
    </form>
  );
}

export default HorarioForm