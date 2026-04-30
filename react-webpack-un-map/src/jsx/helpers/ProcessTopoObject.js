const processTopoObject = (topologyObject, objectName) => {
  // Create a deep clone of the topology object
  const topologyClone = JSON.parse(JSON.stringify(topologyObject));

  const { arcs: topologyArcs, transform } = topologyClone;

  // Function to decode an individual arc (handles negative indices)
  function decodeArc(index) {
    // Get the arc based on index
    // eslint-disable-next-line no-bitwise
    const arc = topologyArcs[index < 0 ? ~index : index]; // If index is negative, flip and get arc

    // Start with the first point, which is absolute (e.g., [0, 0] or the first point in the arc)
    const currentPoint = arc[0]; // The first point is absolute, not a delta

    // Convert from projected coordinates to latitude/longitude using the transform
    const decodedArc = arc.map(([dx, dy], idx) => {
      // If it's not the first point, apply the delta to the previous point
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
  const processedGeometries = topoObject.geometries.map(geometry => {
    const decodedCoordinates = geometry.arcs.map(arcSet => {
      // Decode arcs for LineString or MultiLineString
      if (Array.isArray(arcSet)) {
        return arcSet.map(arcIndex => decodeArc(arcIndex));
      }
      return decodeArc(arcSet);
    });

    // Combine all decoded arcs into a MultiLineString
    const multiLineCoordinates = decodedCoordinates.flat();

    return {
      geometry: {
        type: geometry.type,
        coordinates: geometry.type === 'LineString'
          ? decodedCoordinates[0] // Flatten for LineString
          : multiLineCoordinates // Combined MultiLineString
      },
      properties: geometry.properties
    };
  });

  return processedGeometries;
};

export default processTopoObject;
