import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config(); // Carregar variáveis de ambiente

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({origin: ["https://monitor-dengue.vercel.app"]})); 
app.use(express.json());
app.use(bodyParser.json());

const parseCSV = (csvText) => {
  const rows = csvText.split('\n');
  const header = rows[0].split(',');
  const data = rows.slice(1).map(row => {
    const values = row.split(',');
    const obj = {};
    header.forEach((col, index) => {
      obj[col.trim()] = values[index]?.trim();
    });
    return obj;
  });

  return data;
};

const estados = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

const getDengueCases = async (estado, dataInicial, dataFinal) => {
  const URL_BASE = "https://info.dengue.mat.br/api/notif_reduced";
  const PARAMS = `&ages=00-04%20anos,05-09%20anos,10-19%20anos,20-29%20anos,30-39%20anos,40-49%20anos,50-59%20anos,60+%20anos&genders=Mulher,Homem&diseases=Dengue&initial_date=${dataInicial}&final_date=${dataFinal}&chart_type=disease`;

  const casesData = await fetch(`${URL_BASE}?state_abv=${estado}${PARAMS}`)
      .then(res => res.text())
      .then(data => {
        const parsedData = parseCSV(data)
        return {
          casos: parsedData[0]?.casos
        };
      })
      .catch(() => ({ casos: data }));

  return [casesData];
  // if (estado === 'BR') {
  //     const estados = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
      
  //     const casesData = await Promise.all(estados.map(state =>
  //         fetch(`${URL_BASE}?state_abv=${state}${PARAMS}`)
  //           .then(res => res.text())
  //           .then(data => {
  //             const parsedData = parseCSV(data)
  //             return {
  //               casos: parsedData[0]?.casos || 0
  //             };
  //           })
  //           .catch(() => ({ casos: data }))
  //     ));

  //     return casesData;
  // } else {
  // }
};
const getYearParams = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const lastYear = currentYear - 1;

  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); 
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const currentDate = formatDate(now);
  const lastYearDate = formatDate(new Date(now.setFullYear(lastYear))); 

  return { currentYear, lastYear, currentDate, lastYearDate };
};


app.get("/dengue_api/version", async (req, res) => {
  try {
      const response = await axios.get("https://info.dengue.mat.br/api/alertcity?geocode=3304557&disease=dengue&format=json");
      res.json(response.data[0]?.versao_modelo);
  } catch (error) {
      res.status(500).json({ error: "Erro ao obter dados" });
  }
});

const getMunicipios = async (uf) => {
  const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`;
  const response = await fetch(url);
  return response.json();
};

// const getTodosMunicipios = async () => {
//   console.log("Buscando todos os municípios...");
  
//   const url = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
//   const response = await fetch(url);

//   return response.json();
// };


const getDengueData = async (municipios) => {
  const batchSize = 100;
  let riscos = [];
  const { currentYear, lastYear, currentDate, lastYearDate } = getYearParams();

  for (let i = 0; i < municipios.length; i += batchSize) {
      const batch = municipios.slice(i, i + batchSize);

      const requests = batch.map(mun =>
          fetch(`https://info.dengue.mat.br/api/alertcity?geocode=${mun.id}&disease=dengue&format=json&ew_start=1&ew_end=50&ey_start=${lastYear}&ey_end=${currentYear}`)
              .then(res => res.json())
              .then(data => data[0]?.nivel || 0)
              .catch(() => 0)
      );

      const results = await Promise.all(requests);
      riscos.push(...results);
  }

  return riscos;
};

app.get("/dengue_api/uf/:uf", async (req, res) => {
  try {
      const uf = req.params.uf.toUpperCase();

      const { currentYear, lastYear, currentDate, lastYearDate } = getYearParams(); // Obtendo os anos dinamicamente

      const municipios = await getMunicipios(uf);

      if (!municipios.length) {
          return res.status(404).json({ error: "Estado não encontrado" });
      }

      const casos = await getDengueCases(uf, lastYearDate, currentDate)
      const casosNum = casos[0]?.casos

      const riscos = await getDengueData(municipios);
      const mediaRisco = riscos.reduce((sum, r) => sum + r, 0) / riscos.length;

      const municipiosEmAlerta4 = municipios.filter((mun, index) => riscos[index] === 4);

      const nivel4Count = municipiosEmAlerta4.length;
      const porcentagemNivel4 = (nivel4Count / municipios.length) * 100;

      res.json({
          total_casos: casosNum,
          media_risco: mediaRisco.toFixed(2),
          porcentagem_alerta_4: porcentagemNivel4.toFixed(2),
      });
  } catch (error) {
      res.status(403).json({ error: "Erro ao processar dados" });
  }
});

// app.get("/dengue_api/br", async (req, res) => {
//   try {
//       console.log("Iniciando coleta de dados para todo o Brasil...");

//       const municipios = await getTodosMunicipios();

//       const { currentYear, lastYear, currentDate, lastYearDate } = getYearParams();

//       const casos = await getDengueCases('BR', lastYearDate, currentDate)
      
//       const totalCasos = casos.reduce((total, item) => total + Number(item.casos), 0);


//       const riscos = await getDengueData(municipios);
//       const mediaRisco = riscos.reduce((sum, r) => sum + r, 0) / riscos.length;

//       const municipiosEmAlerta4 = municipios.filter((mun, index) => riscos[index] === 4);

//       const nivel4Count = municipiosEmAlerta4.length;
//       const porcentagemNivel4 = (nivel4Count / municipios.length) * 100;

//       res.json({
//           total_municipios: municipios.length,
//           total_casos: totalCasos,
//           media_risco: mediaRisco.toFixed(2),
//           porcentagem_alerta_4: porcentagemNivel4.toFixed(2),
//       });

//   } catch (error) {
//       console.error("Erro ao processar dados:", error);
//       res.status(500).json({ error: "Erro ao obter dados" });
//   }
// });


const getDengueDataByState = async (state_abv) => {
  const { currentYear, lastYear, currentDate, lastYearDate } = getYearParams();
  const URL = "https://info.dengue.mat.br/api/notif_reduced";
  const PARAMS = {
      state_abv,
      ages: "00-04 anos,05-09 anos,10-19 anos,20-29 anos,30-39 anos,40-49 anos,50-59 anos,60 anos",
      genders: "Mulher,Homem",
      diseases: "Dengue",
      lastYearDate,
      currentDate,
      chart_type: "period"
  };

  try {
      const response = await axios.get(URL, { params: PARAMS });
      return response.data;
  } catch (error) {
      console.error(`Erro ao obter dados para ${state_abv}:`, error);
      return [];
  }
};

app.get("/dengue_api/grafico_uf/:estado", async (req, res) => {
  const estado = req.params.estado.toUpperCase();

  if (!estados.includes(estado)) {
      return res.status(400).json({ error: "Estado inválido. Use a sigla do estado." });
  }

  const data = await getDengueDataByState(estado);
  const formaCsvToJson = parseCSV(data)
  const dtWeeks = [];
  const casos = [];

  formaCsvToJson.forEach(entry => {
      const week = entry.dt_week?.trim();
      const casosCount = parseInt(entry.Casos, 10) || 0;

      if (week) {
          dtWeeks.push(week);
          casos.push(casosCount); 
      }
  });

  if (casos.length > 0 && casos[casos.length - 1] === 0) {
    dtWeeks.pop();
    casos.pop();
  }

  const formattedData = {
      dt_weeks: dtWeeks,
      casos: casos
  };

  res.json(formattedData);
});

// const sumByWeek = (data) => {
//   const weeklySums = {};

//   data.forEach((block) => {
//     block.split("\n").forEach((line) => {
//       const parts = line.trim().split(",");
//       if (parts.length === 2 && parts[0] !== "dt_week") {
//         const date = parts[0];
//         const cases = parseInt(parts[1], 10) || 0;

//         if (!weeklySums[date]) {
//           weeklySums[date] = 0;
//         }
//         weeklySums[date] += cases;
//       }
//     });
//   });

//   let dt_weeks = Object.keys(weeklySums);
//   let casos = Object.values(weeklySums);

//   if (casos.length > 0 && casos[casos.length - 1] === 0) {
//     dt_weeks.pop();
//     casos.pop();
//   }


//   return {
//     dt_weeks,
//     casos
//   };
// };


// app.get("/dengue_api/grafico_br", async (req, res) => {
//   try {
//       const requests = estados.map(estado => getDengueDataByState(estado));
//       const results = await Promise.all(requests);

//       const formmatedData = sumByWeek(results)

//       res.json(formmatedData);

//   } catch (error) {
//       console.error("Erro ao obter dados para o Brasil:", error);
//       res.status(500).json({ error: "Erro ao obter dados para o Brasil" });
//   }
// });





app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
