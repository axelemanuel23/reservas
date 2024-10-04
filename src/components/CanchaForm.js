// components/CanchaForm.js
import React, { useState } from 'react';
import axios from 'axios';

function CanchaForm({ onCanchaAdded }) {
  const [newCancha, setNewCancha] = useState({ nombre: '', descripcion: '' });

  const addCancha = async (e) => {
    e.preventDefault();
    await axios.post('http://localhost:5000/api/v1/admin/canchas', newCancha);
    setNewCancha({ nombre: '', descripcion: '' });
    onCanchaAdded();
  };

  return (
    <form onSubmit={addCancha} className="mb-6">
      <h3 className="text-xl font-bold mb-2">Agregar Cancha</h3>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Nombre de la cancha"
          value={newCancha.nombre}
          onChange={(e) => setNewCancha({ ...newCancha, nombre: e.target.value })}
          className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
        />
      </div>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Descripción de la cancha"
          value={newCancha.descripcion}
          onChange={(e) => setNewCancha({ ...newCancha, descripcion: e.target.value })}
          className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
        />
      </div>
      <button type="submit" className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline">
        Agregar Cancha
      </button>
    </form>
  );
}

export default CanchaForm