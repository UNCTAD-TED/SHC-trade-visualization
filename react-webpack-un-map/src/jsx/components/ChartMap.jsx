import React, {
  useEffect, useCallback, useRef
} from 'react';
import PropTypes from 'prop-types';

// https://www.highcharts.com/
import Highcharts from 'highcharts';
import 'highcharts/modules/map';
import 'highcharts/modules/accessibility';
import 'highcharts/modules/exporting';
import 'highcharts/modules/export-data';
import 'highcharts/modules/pattern-fill';

import processTopoObjectPolygons from '../helpers/ProcessTopoObjectPolygons.js';
import processTopoObject from '../helpers/ProcessTopoObject.js';
import createMaplineSeries from '../helpers/CreateMaplineSeries.js';
import getColor from '../helpers/GetColor.js';
import getColorAxis from '../helpers/GetColorAxis.js';

// https://www.npmjs.com/package/uuid4
// import { v4 as uuidv4 } from 'uuid';

function ChartMap({ values }) {
  const chartMapRef = useRef(null);
  const createMap = useCallback((data, topology) => {
    // Prepare a mapping of code -> labelen, labelfr from topology
    const labelMap = topology.objects.economies.geometries.reduce((mapLabel, geometry) => {
      const { code, labelen, labelfr } = geometry.properties; // Extract properties from geometry
      mapLabel[code] = { labelen, labelfr }; // Map code to labelen and labelfr
      return mapLabel;
    }, {});
    // Manually insert European Union label
    labelMap['918'] = {
      labelen: 'European Union',
      labelfr: 'Union européenne'
    };
    const chinaAreas = ['156', '158', '344', '446'];

    // const pointFormat = (data_type) => {
    //   return '<strong>All: {point.all:.1f}%</strong><br />Agriculture: {point.agriculture:.1f}%<br />Energy: {point.energy:.1f}%<br />Mining: {point.mining:.1f}%';
    // };

    Highcharts.setOptions({
      lang: {
        decimalPoint: '.',
        downloadCSV: 'Download CSV data',
        thousandsSep: ' '
      }
    });
    Highcharts.SVGRenderer.prototype.symbols.download = (x, y, w, h) => {
      const path = [
        // Arrow stem
        'M', x + w * 0.5, y,
        'L', x + w * 0.5, y + h * 0.7,
        // Arrow head
        'M', x + w * 0.3, y + h * 0.5,
        'L', x + w * 0.5, y + h * 0.7,
        'L', x + w * 0.7, y + h * 0.5,
        // Box
        'M', x, y + h * 0.9,
        'L', x, y + h,
        'L', x + w, y + h,
        'L', x + w, y + h * 0.9
      ];
      return path;
    };
    chartMapRef.current = Highcharts.mapChart('map_container', {
      caption: {
        align: 'left',
        margin: 15,
        style: {
          color: 'rgba(0, 0.0, 0.0, 0.8)',
          fontSize: '13px'
        },
        text: '<em>Source:</em> UN Trade and Development (UNCTAD), 2025<br /><em>Note:</em> Data in light grey are not available, <a href="https://unctad.org/page/map-disclaimer" target="_blank">Map disclaimer</a>, https://unctad.org/map-disclaimer',
        useHTML: true,
        verticalAlign: 'bottom',
        x: 0
      },
      chart: {
        backgroundColor: '#f4f9fd',
        height: Math.max((document.getElementById('map_container').offsetWidth * 9) / 16, 400),
        type: 'map'
      },
      colorAxis: getColorAxis(),
      credits: {
        enabled: false
      },
      exporting: {
        buttons: {
          contextButton: {
            menuItems: ['viewFullscreen', 'separator', 'downloadPNG', 'downloadPDF', 'separator', 'downloadCSV'],
            symbol: 'download',
            symbolFill: '#000',
            y: 10
          }
        },
        enabled: true,
        filename: '__PROJECT_NAME__'
      },
      legend: {
        align: 'left',
        enabled: true,
        events: {
          itemClick() {
            return false;
          }
        },
        itemDistance: 10,
        itemStyle: {
          cursor: 'default',
          fontSize: '15px',
          fontWeight: 400
        },
        verticalAlign: 'top'
      },
      mapNavigation: {
        buttonOptions: {
          verticalAlign: 'bottom'
        },
        enableButtons: true,
        enabled: false
      },
      plotOptions: {
        mapline: {
          lineWidth: 0.33,
          tooltip: {
            enabled: false
          }
        },
        series: {
          point: {
            events: {
              mouseOver() {
                const element = this;
                if (element.id === 'C00003') {
                  return false;
                }
                if (chinaAreas.includes(element.id)) {
                  const { chart } = element.series;
                  chinaAreas.forEach((area) => {
                    chart.get(area)?.setState('hover');
                  });
                }
                return true;
              },
              mouseOut() {
                const element = this;
                const { chart } = element.series;
                chinaAreas.forEach((area) => {
                  chart.get(area)?.setState('');
                });
              }
            }
          }
        }
      },
      responsive: {
        rules: [{
          chartOptions: {
            title: {
              style: {
                fontSize: '26px',
                lineHeight: '30px'
              }
            },
            exporting: {
              enabled: false
            }
          },
          condition: {
            maxWidth: 500
          }
        }]
      },
      series: [
        {
          // The colored layer series.
          affectsMapView: true,
          data: processTopoObjectPolygons(topology, 'economies-color').map(region => {
            const match = data.find(row => row.code === region.properties.code);
            const value = match ? parseFloat(match.value) : null;
            const { code } = region.properties; // Store region code
            let labelen = code;
            if (labelMap[code]) {
              labelen = labelMap[code].labelen;
            }
            return {
              borderWidth: 0,
              color: getColor(value, code, data, 'value', chinaAreas),
              geometry: region.geometry,
              id: code,
              name: labelen,
              value
            };
          }),
          enableMouseTracking: true,
          name: 'economies_color',
          states: {
            hover: {
              borderColor: '#fff',
              borderWidth: 2
            }
          },
          type: 'map',
          visible: true,
        },
        {
          // The helper layer series.
          affectsMapView: false,
          data: processTopoObjectPolygons(topology, 'economies').map(region => ({
            borderWidth: 0,
            geometry: region.geometry
          })),
          enableMouseTracking: false,
          name: 'economies',
          type: 'map',
          visible: false
        },
        // Using the function to create mapline series
        createMaplineSeries('dash_borders', processTopoObject(topology, 'dashed-borders'), 'Dash'),
        createMaplineSeries('dot_borders', processTopoObject(topology, 'dotted-borders'), 'Dot'),
        createMaplineSeries('dash_dot_borders', processTopoObject(topology, 'plain-borders'), 'DashDot'),
        createMaplineSeries('solid_borders', processTopoObject(topology, 'plain-borders'), 'Solid'),
      ],
      subtitle: {
        text: null,
      },
      tooltip: {
        enabled: true,
        headerFormat: '<span style="font-size: 15px;"><strong>{point.name}</strong></span><br /><br />',
        // pointFormat: pointFormat(type),
        style: {
          color: '#000',
          fontSize: '13px'
        }
      },
      title: {
        text: null,
      }
    });
    return () => {
      if (chartMapRef.current) {
        chartMapRef.current.destroy(); // Cleanup on unmount
        chartMapRef.current = null;
      }
    };
  }, [chartMapRef]);

  useEffect(() => {
    const [topology, data] = values;
    createMap(data, topology);
  }, [createMap, values]);

  return (
    <div>
      <div id="map_container" ref={chartMapRef} />
    </div>
  );
}

export default ChartMap;

ChartMap.propTypes = {
  values: PropTypes.arrayOf(PropTypes.oneOfType([
    PropTypes.object,
    PropTypes.array
  ])).isRequired
};
