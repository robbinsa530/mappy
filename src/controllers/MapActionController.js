import React from 'react';
import cloneDeep from 'lodash.clonedeep';
import mapboxgl from '!mapbox-gl'; // eslint-disable-line import/no-webpack-loader-syntax

//Used to move a marker back to its old spot after a move action is undone
export function moveMarkerBack(info) {
  // There are 3 possible cases. All of them require this step (moving the marker back to its old loc)
  info.marker.lngLat = info.oldPosition;
  info.marker.markerObj.setLngLat(info.oldPosition);
  // The 3 cases are:
  // 1. The only existing marker was moved. Nothing else needs to be done
  // 2. An end point was moved. Move it back and adjust one line (if info.lines.length === 1)
  // 3. A middle point was moved. Move it back, and adjust 2 lines (if info.lines.length === 2)
  info.lines.forEach(l => {
    l.lineRef.properties.distance = l.oldLineCopy.properties.distance;
    l.lineRef.properties.eleUp = l.oldLineCopy.properties.eleUp;
    l.lineRef.properties.eleDown = l.oldLineCopy.properties.eleDown;
    l.lineRef.geometry.coordinates = l.oldLineCopy.geometry.coordinates;
  });
}

// Used to add a marker back when a delete action is undone
export function addMarkerBack(info, markers, geojson, map) {
  if (info.lines.length === 0) {
    // A sole marker was deleted. Just add it back
    info.marker.markerObj.addTo(map.current);
    markers.push(info.marker);
  }
  else if (info.lines.length === 1) {
    // An end point was deleted. Add it and its one associated line back
    info.marker.markerObj.addTo(map.current);
    markers.splice(info.index, 0, info.marker);
    info.lines[0].otherMarker.associatedLines.push(info.lines[0].line.properties.id);
    geojson.features.splice(info.lines[0].lineIndex, 0, info.lines[0].line);
    // Update color classes
    const otherMarkerIndex = markers.findIndex(m => m.id === info.lines[0].otherMarker.id);
    if (otherMarkerIndex === 0) {
      info.lines[0].otherMarker.markerObj.removeClassName("marker").removeClassName("end-marker").addClassName("start-marker");
    }
    else if (otherMarkerIndex === markers.length - 1) {
      info.lines[0].otherMarker.markerObj.removeClassName("marker").removeClassName("start-marker").addClassName("end-marker");
    }
    else {
      // Other point is no
      info.lines[0].otherMarker.markerObj.removeClassName("start-marker").removeClassName("end-marker").addClassName("marker");
    }
  }
  else { // info.lines.length === 2
    // A middle point was deleted. Add it back, and split line into 2 lines

    // Sanity check
    if (info.lines[1].lineIndex !== info.lines[0].lineIndex + 1) {
      console.error("Geojson lines were out of order somehow. Undo failed.");
      alert("Undo failed");
      return;
    }

    info.marker.markerObj.addTo(map.current);
    markers.splice(info.index, 0, info.marker);
    geojson.features = geojson.features.filter(
      f => f.properties.id !== info.lineAddedOnDeleteId
    );
    geojson.features.splice(info.lines[0].lineIndex, 0, info.lines[0].line, info.lines[1].line);
    info.lines[0].otherMarker.associatedLines = info.lines[0].otherMarker.associatedLines.filter(l => l !== info.lineAddedOnDeleteId);
    info.lines[1].otherMarker.associatedLines = info.lines[1].otherMarker.associatedLines.filter(l => l !== info.lineAddedOnDeleteId);
    info.lines[0].otherMarker.associatedLines.push(info.lines[0].line.properties.id);
    info.lines[1].otherMarker.associatedLines.push(info.lines[1].line.properties.id);
  }
}

export async function removeMarker(markerIdToRemove, markers, geojson, getDirections) {
  let markerToRemoveIndex = markers.findIndex(m => m.id === markerIdToRemove);
  let markerToRemove = markers[markerToRemoveIndex];
  markerToRemove.markerObj.remove();
  markers.splice(markerToRemoveIndex, 1);
  let toReturn = {
    marker: markerToRemove,
    index: markerToRemoveIndex,
    lines: [ // Can hold 0-2 lines
      // { 
      //   line: LineString Feature,
      //   lineIndex: Number,
      //   otherMarker: Marker obj,
      // }
    ],
    lineAddedOnDeleteId: null
  };
  if (markers.length > 1) {
    // Marker removed. Update all associated lines
    if (markerToRemove.associatedLines.length === 1) {
      // End point. Remove associated line, update new end point
      const lineToRemoveId = markerToRemove.associatedLines[0];
      const lineToRemoveIndex = geojson.features.findIndex(
        f => f.properties.id === lineToRemoveId
      );
      const lineToRemove = geojson.features[lineToRemoveIndex];
      toReturn.lines.push({
        line: lineToRemove,
        lineIndex: lineToRemoveIndex,
        otherMarker: null // To be filled
      });
      geojson.features.splice(lineToRemoveIndex, 1);

      // Remove all references to the deleted line from all markers
      markers.forEach((m,i) => {
        const startLen = m.associatedLines.length;
        markers[i].associatedLines = m.associatedLines.filter(
          l => l !== lineToRemoveId
        );
        const endLen = markers[i].associatedLines.length;
        if (startLen !== endLen) { // Marker was associated with line
          toReturn.lines[0].otherMarker = markers[i];
        }
      });

      //Edit class of start/end marker so it'll be white
      if (markerToRemoveIndex === 0) { // Start removed
        markers[0].markerObj.removeClassName("marker").addClassName("start-marker")
      } else { // End removed
        markers[markers.length -1].markerObj.removeClassName("marker").addClassName("end-marker");
      }
    }
    else if (markerToRemove.associatedLines.length > 1) {
      // Middle point. Remove associated lines, reroute, update
      const linesToRemove = markerToRemove.associatedLines;
      const lineIndices = linesToRemove.map(l => {
        return geojson.features.findIndex(f => f.properties.id === l);
      });
      const line1Index = Math.min(...lineIndices);
      toReturn.lines.push({
        line: geojson.features[line1Index],
        lineIndex: line1Index,
        otherMarker: null // To be filled
      });
      const line2Index = Math.max(...lineIndices);
      toReturn.lines.push({
        line: geojson.features[line2Index],
        lineIndex: line2Index,
        otherMarker: null // To be filled
      });
      geojson.features = geojson.features.filter(
        f => !linesToRemove.includes(f.properties.id)
      );

      // Remove all references to the deleted line from affected markers
      const lMarker = markers[markerToRemoveIndex - 1];
      const rMarker = markers[markerToRemoveIndex /*+ 1*/]; // Don't need to +1 b/c marker has already been removed
      lMarker.associatedLines = lMarker.associatedLines.filter(l => !linesToRemove.includes(l));
      rMarker.associatedLines = rMarker.associatedLines.filter(l => !linesToRemove.includes(l));

      // Calculate new route and insert where the old lines were
      const newLine = await getDirections(lMarker.lngLat, rMarker.lngLat);
      toReturn.lineAddedOnDeleteId = newLine.properties.id;
      geojson.features.splice(Math.min(...lineIndices), 0, newLine);

      // Update markers at ends of new line with line's id
      lMarker.associatedLines.push(newLine.properties.id);
      rMarker.associatedLines.push(newLine.properties.id);
      toReturn.lines[0].otherMarker = lMarker;
      toReturn.lines[1].otherMarker = rMarker;
    }
    else if (markerToRemove.associatedLines.length === 0) {
      // Should never happen...
      alert("Error deleting point.");
      console.error("Multiple markers exist after removal, but removed marker had no associated lines. Not sure how that happened...");
    }
  } else {
    if (markers.length === 1) {
      toReturn.lines.push({
        line: geojson.features[0],
        lineIndex: 0,
        otherMarker: markers[0]
      });
    }
    geojson.features = [];
    markers.forEach((_,i) => {
      markers[i].associatedLines = [];
      markers[i].markerObj.removeClassName("marker").removeClassName("end-marker").addClassName("start-marker");
    });
  }
  return toReturn;
}

export async function handleLeftRightClick(e, markers, geojson, undoActionList, map, updateDistanceInComponent, getDirections, rightClick, addToEnd/*standard*/) {
  // If anything but a point was clicked, add a new one
  if (!markers.map(m => m.element).includes(e.originalEvent.target)) {
    // Create a new DOM node and save it to a React ref. This will be the marker element
    const ref = React.createRef();
    ref.current = document.createElement('div');
    const idToUse = String(new Date().getTime());
    
    // Create a Mapbox Popup with delete button
    const divRef = React.createRef();
    const btnRef = React.createRef();
    divRef.current = document.createElement('div');
    btnRef.current = document.createElement('div');
    btnRef.current.innerHTML = '<button class="marker-popup-btn">Delete point</button>';
    divRef.current.innerHTML = '<div></div>';
    divRef.current.appendChild(btnRef.current);
    btnRef.current.addEventListener('click', async (e) => {
      const undoActionInfo = await removeMarker(idToUse, markers, geojson, getDirections);
      updateDistanceInComponent();
      map.current.getSource('geojson').setData(geojson);

      // Allows for undo of 'delete' action
      undoActionList.push({
        type: 'delete',
        info: undoActionInfo
      });
    });

    let markerToAdd = {
      id: idToUse,
      element: ref.current,
      lngLat: [e.lngLat.lng, e.lngLat.lat],
      associatedLines: []
      // markerObj: (Needs to be added)
    };

    let addedMarker;
    if (addToEnd) {
      // If theres already 1+ markers, calculate directions/distance
      if (markers.length > 0) {
        let prevPt = markers[markers.length-1];
        const newLine = await getDirections(
          [prevPt.lngLat[0], prevPt.lngLat[1]],
          markerToAdd.lngLat,
          (rightClick) ? false : undefined // If right click, just this time don't calculate directions
        );
        // Associate this new line with both of its endpoint markers
        // This is so we can know which lines to edit on marker delete/move
        prevPt.associatedLines.push(newLine.properties.id); // markers[markers.length-1]
        markerToAdd.associatedLines.push(newLine.properties.id);

        // Update position of marker. This is in case click wasn't on a road or path,
        // the API will return the closest point to a road or path. That's what we wanna use
        markerToAdd.lngLat = newLine.geometry.coordinates[newLine.geometry.coordinates.length -1];

        if (markers.length === 1) { // Only on the second point, make sure we update the first too
          markers[0].markerObj.setLngLat(newLine.geometry.coordinates[0]);
          markers[0].lngLat = newLine.geometry.coordinates[0];
        }

        geojson.features.push(newLine);
        updateDistanceInComponent();

        //Edit class of last end marker so it'll be white
        if (markers.length > 1) {
          prevPt.markerObj.removeClassName("end-marker").addClassName("marker");
        }

        // Redraw lines on map
        map.current.getSource('geojson').setData(geojson);
      }

      addedMarker = new mapboxgl.Marker({
        className: markers.length ? "end-marker" : "start-marker",
        element: ref.current,
        draggable: true
      }).setLngLat(markerToAdd.lngLat)
        .setPopup(new mapboxgl.Popup().setDOMContent(divRef.current))
        .addTo(map.current);

      // Add marker to running list
      markerToAdd.markerObj = addedMarker;
      markers.push(markerToAdd);
    }
    else { // Add to start
      // If theres already 1+ markers, calculate directions/distance
      if (markers.length > 0) {
        let prevPt = markers[0];
        const newLine = await getDirections(
          markerToAdd.lngLat,
          [prevPt.lngLat[0], prevPt.lngLat[1]],
          (rightClick) ? false : undefined // If right click, just this time don't calculate directions
        );
        // Associate this new line with both of its endpoint markers
        // This is so we can know which lines to edit on marker delete/move
        prevPt.associatedLines.push(newLine.properties.id); // markers[markers.length-1]
        markerToAdd.associatedLines.push(newLine.properties.id);

        // Update position of marker. This is in case click wasn't on a road or path,
        // the API will return the closest point to a road or path. That's what we wanna use
        markerToAdd.lngLat = newLine.geometry.coordinates[0];

        if (markers.length === 1) { // Only on the second point, make sure we update the first too
          markers[0].markerObj.setLngLat(newLine.geometry.coordinates[newLine.geometry.coordinates.length - 1]);
          markers[0].lngLat = newLine.geometry.coordinates[newLine.geometry.coordinates.length - 1];
        }

        geojson.features.unshift(newLine);
        updateDistanceInComponent();

        // Edit class of last end marker so it'll be white (or red if there was only 1)
        if (markers.length === 1) {
          prevPt.markerObj.removeClassName("start-marker").addClassName("end-marker");
        } else {
          prevPt.markerObj.removeClassName("start-marker").addClassName("marker");
        }

        // Redraw lines on map
        map.current.getSource('geojson').setData(geojson);
      }

      addedMarker = new mapboxgl.Marker({
        className: "start-marker",
        element: ref.current,
        draggable: true
      }).setLngLat(markerToAdd.lngLat)
        .setPopup(new mapboxgl.Popup().setDOMContent(divRef.current))
        .addTo(map.current);

      // Add marker to running list
      markerToAdd.markerObj = addedMarker;
      markers.unshift(markerToAdd);
    }

    // Allows for undo of 'add' action
    undoActionList.push({
      type: 'add',
      marker: markerToAdd
    });

    addedMarker.on('dragend', async (e) => {
      let draggedMarkerIndex = markers.findIndex(el => el.id === idToUse);
      let draggedMarker = markers[draggedMarkerIndex];
      let dragActionInfo = {
        marker: draggedMarker,
        oldPosition: [...draggedMarker.lngLat], // Want copy since we're about to change this
        lines: [ // Can hold 0-2 lines.
          // {
          //   oldLineCopy: LineString Feature (Copy),
          //   lineRef: LineString Feature (Reference)
          // }
        ]
      };
      draggedMarker.lngLat = [e.target._lngLat.lng, e.target._lngLat.lat];
      if (markers.length > 1) {
        if (draggedMarker.associatedLines.length >= 1) {
          // Edit 1 or 2 associated lines
          let linesToEdit = [];
          draggedMarker.associatedLines.forEach(l => {
            linesToEdit.push(geojson.features.find(f => f.properties.id === l));
          });

          for (const [i, l] of linesToEdit.entries()) { // CANNOT use .forEach here b/c async
            dragActionInfo.lines.push({
              oldLineCopy: cloneDeep(l), // Need a deep clone b/c we're about to edit this obj's nested members
              lineRef: linesToEdit[i]
            });
            // Find other marker associated with line
            const otherMarkerIndex = markers.findIndex(m => m.id !== idToUse && m.associatedLines.includes(l.properties.id));
            // Replace old line with new one
            const sIndex = Math.min(draggedMarkerIndex, otherMarkerIndex);
            const eIndex = Math.max(draggedMarkerIndex, otherMarkerIndex);
            const newLine = await getDirections(markers[sIndex].lngLat, markers[eIndex].lngLat);
            linesToEdit[i].properties.distance = newLine.properties.distance;
            linesToEdit[i].properties.eleUp = newLine.properties.eleUp;
            linesToEdit[i].properties.eleDown = newLine.properties.eleDown;
            linesToEdit[i].geometry.coordinates = newLine.geometry.coordinates;

            // Update position of marker. This is in case it wasn't dragged onto a road or path,
            // the API will return the closest point to a road or path. That's what we wanna use
            if (i === 0) {
              const coordIndex = (draggedMarkerIndex < otherMarkerIndex) ? 0 : newLine.geometry.coordinates.length -1;
              draggedMarker.markerObj.setLngLat(newLine.geometry.coordinates[coordIndex]);
              draggedMarker.lngLat = newLine.geometry.coordinates[coordIndex];
            }
          }
        }
        else if (draggedMarker.associatedLines.length === 0) {
          // Should never happen...
          alert("Error moving point.");
          console.error("Multiple markers exist, but dragged marker had no associated lines. Not sure how that happened...");
        }
        updateDistanceInComponent();
        map.current.getSource('geojson').setData(geojson);
      }
      // Allows for undo of 'move' action
      undoActionList.push({
        type: 'move',
        info: dragActionInfo
      });
    });
  }
}
