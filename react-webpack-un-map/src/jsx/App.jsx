import React, { useState, useEffect, useRef } from 'react';
import '../styles/styles.less';

// Load helpers.
import ChartMap from './components/ChartMap.jsx';

function App() {
  const [data, setData] = useState(false);

  const appRef = useRef(null);

  const fetchExternalData = () => {
    const dataPath = `${(window.location.href.includes('unctad.org')) ? 'https://storage.unctad.org/__PROJECT_NAME__/' : (window.location.href.includes('localhost:80')) ? './' : 'https://unctad-infovis.github.io/__PROJECT_NAME__/'}assets/data/`;

    const topology_file = 'worldmap-economies-54030.topo.json';
    const data_file = 'data.json';
    let values;
    try {
      values = Promise.all([
        fetch(dataPath + topology_file),
        fetch(dataPath + data_file),
      ]).then(results => Promise.all(results.map(result => result.json())));
    } catch (error) {
      console.error(error);
    }
    return values;
  };

  useEffect(() => {
    fetchExternalData().then((result) => setData(result));
  }, []);

  return (
    <div className="app" ref={appRef}>
      <div className="title_container">
        <img src="https://static.dwcdn.net/custom/themes/unctad-2024-rebrand/Blue%20arrow.svg" className="logo" alt="UN Trade and Development logo" />
        <div className="title">
          <h3>test</h3>
          <h4>Subtitle</h4>
        </div>
      </div>
      {data !== false && <ChartMap values={data} />}
    </div>
  );
}

export default App;
