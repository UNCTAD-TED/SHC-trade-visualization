// process polygons objects
const processTopoObjectPolygons = (topologyObjectPolygons, objectName) => {
  // Create a deep clone of the topology object
  const topologyClone = JSON.parse(JSON.stringify(topologyObjectPolygons));

  const { arcs: topologyArcs, transform } = topologyClone;

  // Function to decode an individual arc (handles negative indices)
  function decodeArc(index) {
    // Get the arc based on index
    // eslint-disable-next-line no-bitwise
    const arc = topologyArcs[index < 0 ? ~index : index]; // If index is negative, flip and get arc

    // Create a copy of the arc to avoid side effects
    const currentPoint = [...arc[0]]; // Clone the first point
    const arcCopy = arc.map(([dx, dy]) => [dx, dy]); // Deep copy the arc

    // Convert from projected coordinates to latitude/longitude using the transform
    const decodedArc = arcCopy.map(([dx, dy], idx) => {
      if (idx !== 0) {
        currentPoint[0] += dx; // Cumulative change in x
        currentPoint[1] += dy; // Cumulative change in y
      }

      // Apply the transformation to convert from projected to lat/lon
      const coordinateScaleFactor = 1 / 100000;
      return [
        (currentPoint[0] * transform.scale[0] + transform.translate[0]) * coordinateScaleFactor,
        (currentPoint[1] * transform.scale[1] + transform.translate[1]) * coordinateScaleFactor
      ];
    });

    // If the original index was negative, reverse the decoded arc
    return index < 0 ? decodedArc.reverse() : decodedArc;
  }

  // Access the specified object in the topology
  const topoObject = topologyClone.objects[objectName];
  if (!topoObject) {
    console.error(`Object "${objectName}" not found in topology.`);
    return [];
  }

  // Process the geometries in the specified object
  const processedGeometries = topoObject.geometries
    // .filter(geometry => ["604", "250", "398", "352"].includes(geometry.properties.code)) // Filter for multiple codes
    .map(geometry => {
      const decodedCoordinates = geometry.arcs.map(arcSet => {
        if (Array.isArray(arcSet[0])) {
          // MultiPolygon
          return arcSet.map(subArcSet => subArcSet.flatMap(decodeArc));
        }
        // Polygon
        return arcSet.flatMap(decodeArc);
      });
      return {
        geometry: {
          type: geometry.type,
          coordinates: geometry.type === 'Polygon'
            ? decodedCoordinates
            : decodedCoordinates
        },
        properties: geometry.properties
      };
    });

  return processedGeometries;
};

export default processTopoObjectPolygons;
