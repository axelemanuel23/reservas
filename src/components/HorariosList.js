import React from 'react';

function HorariosList({ reservas, onReservaUpdate, selectedDate }) {
  // Separate pending and accepted reservations
  const [horarios, setHorarios] = useState([]);

  const fetchHorarios = async () => {
    const res = await axios.get(`https://nodejs-backend-arch.onrender.com//api/v1/canchareserva/admin/horarios/${selectedCancha}`,
    {  
      headers : { 
        "apikey":"axel"
      }
    });
    setHorarios(res);
  };

  
  return (
    <div>
        {fetchHorarios()}
        {console.log(horarios)}
    </div>
  );
}

export default HorariosList;