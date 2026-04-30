// Function to create mapline series
const createMaplineSeries = (name, mapData, dashStyle) => ({
  affectsMapView: false,
  dashStyle,
  mapData: mapData.map(border => ({
    color: 'rgba(255, 255, 255, 0.6)',
    geometry: border.geometry,
    lineWidth: 1,
    name: border.properties.code
  })),
  name,
  states: {
    inactive: {
      enabled: false
    }
  },
  type: 'mapline'
});

export default createMaplineSeries;
