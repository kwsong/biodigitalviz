import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import './styles/App.css';
import './styles/Modal.css';

// Configuration constants
const AIRTABLE_CONFIG = {
  baseId: 'appRiU9sw7RjOdGbk',
  token: 'patiiLJEXjP1oExM6.2b93f838d611daaab7c886ea6ebd86f6264ba697d2520d126ce8d344c9ddb8a6',
  tableId: 'tblYix3jMMM9MhIds'
};

// Field mapping - Airtable field names to internal field names
const FIELD_MAPPING = {
  name: 'Project Title',
  author: 'Author(s)/Creator(s)',
  img_name: 'Image Link',
  year: 'Year',
  gmo: 'Genetically Modified',
  url: 'Website Link',
  organism: 'Organism',
  trigger: 'Trigger', 
  output: 'Observable Output of organism',
  scale: 'Scale',
  temporality: 'Speed of reaction',
  'role-organism': 'Role of organism for digital',
  'role-digital': 'Role of digital for organism'
};

const BioDigitalSankeyApp = () => {
  // Constants
  const allColumns = useMemo(() => [
    'organism', 'trigger', 'output', 'scale', 'temporality', 'role-organism', 'role-digital'
  ], []);
  
  const columnLabels = useMemo(() => [
    'Organism', 'Trigger', 'Observable Output', 'Scale', 'Temporality', 'Organism → Digital Role', 'Digital → Organism Role'
  ], []);

  // State
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [visibleColumns, setVisibleColumns] = useState([...allColumns]);
  const [filters, setFilters] = useState({ organism: '', scale: '', temporality: '' });
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailContent, setDetailContent] = useState({ title: '', content: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Refs
  const svgRef = useRef();
  const currentGraph = useRef(null);
  const draggedElement = useRef(null);
  const containerRef = useRef();

  // Helper function to normalize field to array
  const normalizeToArray = useCallback((fieldValue) => {
    if (Array.isArray(fieldValue)) {
      return fieldValue.map(v => v.toString().trim()).filter(Boolean);
    } else if (typeof fieldValue === 'string') {
      return fieldValue.split(',').map(s => s.trim()).filter(Boolean);
    } else if (fieldValue) {
      return [fieldValue.toString().trim()];
    }
    return [];
  }, []);

  // Load data from Airtable
  const loadFromAirtable = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Loading from Airtable...');
      const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableId}`, {
        headers: {
          'Authorization': `Bearer ${AIRTABLE_CONFIG.token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
      if (!result.records || result.records.length === 0) {
        setError('No records found in Airtable');
        setLoading(false);
        return;
      }

      // Log available fields for debugging
      const firstRecord = result.records[0];
      const availableFields = Object.keys(firstRecord.fields);
      console.log('Available fields in Airtable:', availableFields);
      console.log('Expected fields:', Object.values(FIELD_MAPPING));
      
      const processedData = result.records.map(record => {
        const fields = record.fields;
        
        // Process organism with GMO suffix
        const organismValues = normalizeToArray(fields[FIELD_MAPPING.organism]);
        const isGMO = fields[FIELD_MAPPING.gmo];
        const processedOrganism = organismValues.map(org => `${org}${isGMO ? ' (gmo)' : ''}`);

        const system = {
          id: record.id,
          name: fields[FIELD_MAPPING.name] || 'Unnamed System',
          author: (fields[FIELD_MAPPING.author] || '').toString().trim(),
          img_name: (fields[FIELD_MAPPING.img_name] || '').toString().trim(),
          url: (fields[FIELD_MAPPING.url] || '').toString().trim(),
          organism: processedOrganism,
          gmo: fields[FIELD_MAPPING.gmo],
          trigger: normalizeToArray(fields[FIELD_MAPPING.trigger]),
          output: normalizeToArray(fields[FIELD_MAPPING.output]),
          scale: normalizeToArray(fields[FIELD_MAPPING.scale]),
          temporality: normalizeToArray(fields[FIELD_MAPPING.temporality]),
          'role-organism': normalizeToArray(fields[FIELD_MAPPING['role-organism']]),
          'role-digital': normalizeToArray(fields[FIELD_MAPPING['role-digital']])
        };
        
        // Debug log each processed system
        console.log('Processed system:', system);
        
        return system;
      }).filter(item => item.organism && item.organism.length > 0);

      console.log('Final processed data:', processedData);
      setData(processedData);
      setLoading(false);
    } catch (error) {
      console.error('Error loading from Airtable:', error);
      setError(`Failed to load data: ${error.message}`);
      setLoading(false);
    }
  }, [normalizeToArray]); 

  const addToAirtable = useCallback(async (systemData) => {
    try {
      const airtableData = {
        fields: {
          [FIELD_MAPPING.name]: systemData.name,
          [FIELD_MAPPING.organism]: systemData.organism,
          [FIELD_MAPPING.gmo]: systemData.gmo,
          [FIELD_MAPPING.trigger]: systemData.trigger,
          [FIELD_MAPPING.output]: systemData.output,
          [FIELD_MAPPING.scale]: systemData.scale,
          [FIELD_MAPPING.temporality]: systemData.temporality,
          [FIELD_MAPPING['role-organism']]: systemData['role-organism'],
          [FIELD_MAPPING['role-digital']]: systemData['role-digital']
        }
      };

      const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_CONFIG.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(airtableData)
      });

      if (response.ok) {
        // Only refresh data after successful addition
        await loadFromAirtable();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error adding to Airtable:', error);
      return false;
    }
  }, [loadFromAirtable]);

  // Sankey visualization utilities
  const createSankeyData = useCallback((systems) => {
    const nodes = [];
    const links = [];
    const nodeMap = new Map();

    console.log('=== DEBUG: Creating Sankey data ===');
    console.log('Systems:', systems);
    console.log('Visible columns:', visibleColumns);
    
    // Let's check what the first system looks like
    if (systems.length > 0) {
      console.log('First system data:', systems[0]);
      visibleColumns.forEach(col => {
        console.log(`${col}:`, systems[0][col], 'Type:', typeof systems[0][col]);
      });
    }

    visibleColumns.forEach((column) => {
      let uniqueValues = [
        ...new Set(
          systems.flatMap(d => {
            return normalizeToArray(d[column]);
          }).filter(Boolean)
        )
      ];

      // Force temporality ordering with flexible matching
      if (column === 'temporality') {
        // Define time unit hierarchy (lower index = comes first)
        const timeUnits = ['second', 'minute', 'hour', 'day', 'week'];
        
        uniqueValues.sort((a, b) => {
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          
          // Find which time unit each label contains
          const aUnitIndex = timeUnits.findIndex(unit => aLower.includes(unit));
          const bUnitIndex = timeUnits.findIndex(unit => bLower.includes(unit));
          
          // If both contain the same time unit, check for comparison operators
          if (aUnitIndex === bUnitIndex && aUnitIndex !== -1) {
            // Check for comparison operators: < or ≤ should come before >
            const aHasLessOrEqual = aLower.includes('<') || aLower.includes('≤');
            const bHasLessOrEqual = bLower.includes('<') || bLower.includes('≤');
            const aHasGreater = aLower.includes('>') && !aHasLessOrEqual;
            const bHasGreater = bLower.includes('>') && !bHasLessOrEqual;
            
            // If one has < or ≤ and the other has >, prioritize < or ≤
            if (aHasLessOrEqual && bHasGreater) return -1;
            if (bHasLessOrEqual && aHasGreater) return 1;
            
            // If both have same operator type or neither, sort alphabetically
            return a.localeCompare(b);
          }
          
          // If both contain the same time unit (or both contain none), sort alphabetically
          if (aUnitIndex === bUnitIndex) {
            return a.localeCompare(b);
          }
          
          // If one doesn't contain a recognized time unit, put it at the end
          if (aUnitIndex === -1) return 1;
          if (bUnitIndex === -1) return -1;
          
          // Otherwise, sort by time unit hierarchy
          return aUnitIndex - bUnitIndex;
        });
      } else if (column === 'scale') {
        // Define scale hierarchy from smallest to largest (lower index = comes first)
        const scaleUnits = ['cell', 'organism', 'population', 'ecosystem'];
        
        uniqueValues.sort((a, b) => {
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          
          // Find which scale unit each label contains
          const aUnitIndex = scaleUnits.findIndex(unit => aLower.includes(unit));
          const bUnitIndex = scaleUnits.findIndex(unit => bLower.includes(unit));
          
          // If both contain the same scale unit (or both contain none), sort alphabetically
          if (aUnitIndex === bUnitIndex) {
            return a.localeCompare(b);
          }
          
          // If one doesn't contain a recognized scale unit, put it at the end
          if (aUnitIndex === -1) return 1;
          if (bUnitIndex === -1) return -1;
          
          // Otherwise, sort by scale hierarchy
          return aUnitIndex - bUnitIndex;
        });
      } else if (column === 'role-organism' || column === 'role-digital') {
        // Custom ordering for role columns: input (top) -> others -> output -> power -> none (bottom)
        uniqueValues.sort((a, b) => {
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          
          // Define priority order
          const getOrder = (value) => {
            if (value.startsWith('input')) return 0;      // Top
            if (value.startsWith('output')) return 2;     // Above power
            if (value.startsWith('power')) return 3;      // Above none
            if (value === 'none') return 4;               // Bottom
            return 1;                                     // Everything else in middle
          };
          
          const aOrder = getOrder(aLower);
          const bOrder = getOrder(bLower);
          
          // If same priority group, sort alphabetically
          if (aOrder === bOrder) {
            return a.localeCompare(b);
          }
          
          // Otherwise sort by priority order
          return aOrder - bOrder;
        });
      } else {
        uniqueValues.sort();
      }

      console.log(`Unique values for ${column}:`, uniqueValues);

      uniqueValues.forEach(value => {
        const nodeId = `${column}-${value}`;
        const relatedSystems = systems.filter(d => {
          const systemValues = normalizeToArray(d[column]);
          return systemValues.includes(value);
        });
        const node = {
          id: nodeId,
          name: value,
          category: column,
          value: relatedSystems.length,
          systems: relatedSystems
        };
        nodes.push(node);
        nodeMap.set(nodeId, node);
      });
    });

    console.log('Created nodes:', nodes.length);
    console.log('Node map size:', nodeMap.size);

    systems.forEach(system => {
      for (let i = 0; i < visibleColumns.length - 1; i++) {
        const colA = visibleColumns[i];
        const colB = visibleColumns[i + 1];
        
        const valuesA = normalizeToArray(system[colA]);
        const valuesB = normalizeToArray(system[colB]);

        console.log(`System ${system.name}: ${colA} -> ${colB}`);
        console.log(`  Values A (${colA}):`, valuesA);
        console.log(`  Values B (${colB}):`, valuesB);

        valuesA.forEach(sourceValue => {
          valuesB.forEach(targetValue => {
            if (!sourceValue || !targetValue) return;
            
            const sourceId = `${colA}-${sourceValue}`;
            const targetId = `${colB}-${targetValue}`;
            
            console.log(`  Creating link: ${sourceId} -> ${targetId}`);
            
            const existingLink = links.find(l => l.source.id === sourceId && l.target.id === targetId);

            if (existingLink) {
              existingLink.value += 1;
              existingLink.systems.push(system);
            } else {
              const sourceNode = nodeMap.get(sourceId);
              const targetNode = nodeMap.get(targetId);
              
              console.log(`  Source node found: ${!!sourceNode}, Target node found: ${!!targetNode}`);
              
              if (sourceNode && targetNode) {
                links.push({
                  source: sourceNode,
                  target: targetNode,
                  value: 1,
                  systems: [system]
                });
                console.log(`  ✓ Link created successfully`);
              } else {
                console.warn(`  ✗ Missing nodes for link: ${sourceId} -> ${targetId}`);
              }
            }
          });
        });
      }
    });

    console.log('Generated nodes:', nodes);
    console.log('Generated links:', links);
    return { nodes, links };
  }, [visibleColumns, normalizeToArray]);

  const createLinkPath = (source, target) => {
    const x0 = source.x + source.width;
    const x1 = target.x;
    const y0 = source.y + source.height / 2;
    const y1 = target.y + target.height / 2;
    
    const xi = d3.interpolateNumber(x0, x1);
    const x2 = xi(0.5);
    const x3 = xi(0.5);
    
    return `M${x0},${y0}C${x2},${y0} ${x3},${y1} ${x1},${y1}`;
  };

  // Improved highlighting utilities with blue color
  const highlightCompleteFlows = (targetSystems) => {
    if (!currentGraph.current) return;
    
    const allLinks = d3.selectAll('.link');
    const allNodes = d3.selectAll('.node rect');
    
    // Reset all highlighting
    allLinks
      .classed('flow-dimmed', true)
      .classed('flow-highlighted', false)
    
    allNodes
      .classed('node-dimmed', true)
      .classed('node-highlighted', false)
    
    const targetSystemIds = targetSystems.map(s => s.name || JSON.stringify(s));
    
    // Highlight links with proper stroke-width highlighting
    currentGraph.current.links.forEach((link, linkIndex) => {
      const hasTargetSystem = link.systems.some(linkSystem => 
        targetSystemIds.includes(linkSystem.name || JSON.stringify(linkSystem))
      );
      
      if (hasTargetSystem) {
        const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
        linkElement
          .classed('flow-dimmed', false)
          .classed('flow-highlighted', true)
      }
    });
    
    // Highlight nodes
    currentGraph.current.nodes.forEach((node, nodeIndex) => {
      const hasTargetSystem = node.systems.some(nodeSystem => 
        targetSystemIds.includes(nodeSystem.name || JSON.stringify(nodeSystem))
      );
      
      if (hasTargetSystem) {
        const nodeElement = d3.select(`[data-node-id="${nodeIndex}"]`);
        nodeElement
          .classed('node-dimmed', false)
          .classed('node-highlighted', true)
      }
    });
  };

  const resetHighlighting = () => {
    if (!currentGraph.current) return;
    
    const allLinks = d3.selectAll('.link');
    const allNodes = d3.selectAll('.node rect');
    
    // Reset links to original stroke-width
    currentGraph.current.links.forEach((link, linkIndex) => {
      const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
      linkElement
        .classed('flow-dimmed', false)
        .classed('flow-highlighted', false)
    });
    
    allNodes
      .classed('node-dimmed', false)
      .classed('node-highlighted', false)
  };

  // Consolidated function for showing system details (reduces redundancy)
  const generateSystemDetailsHTML = useCallback((systems) => {
    let content = `
      <p><strong>Related Systems (${systems.length}):</strong></p>
    `;
    
    systems.forEach(system => {
      const imgTag = system.img_name
        ? `<img src="${process.env.PUBLIC_URL}/images/${system.img_name}" alt="${system.name}" class="system-thumb" />`
        : '';

      content += `
        <div class="system-detail">
          <h4><a href="${system.url}" target="_blank" rel="noopener noreferrer" class="link-unstyled">${system.name}${system.author ? ` (${system.author})` : ''}</a></h4>
          <div class="system-detail-grid">
            <div>
              <p>${imgTag}</p>
            </div>
            <div>
              <p><strong>Organism:</strong> ${Array.isArray(system.organism) ? system.organism.join(', ') : system.organism}</p>
              <p><strong>Trigger:</strong> ${Array.isArray(system.trigger) ? system.trigger.join(', ') : system.trigger}</p>
              <p><strong>Output:</strong> ${Array.isArray(system.output) ? system.output.join(', ') : system.output}</p>
            </div>
            <div>
              <p><strong>Scale:</strong> ${Array.isArray(system.scale) ? system.scale.join(', ') : system.scale}</p>
              <p><strong>Temporality:</strong> ${Array.isArray(system.temporality) ? system.temporality.join(', ') : system.temporality}</p>
              <p><strong>Organism Role:</strong> ${Array.isArray(system['role-organism']) ? system['role-organism'].join(', ') : system['role-organism']}</p>
              <p><strong>Digital Role:</strong> ${Array.isArray(system['role-digital']) ? system['role-digital'].join(', ') : system['role-digital']}</p>
            </div>
          </div>
        </div>
      `;
    });
    
    return content;
  }, []);

  // Event Handlers (now using consolidated function)
  const showNodeDetails = useCallback((node) => {
    const content = generateSystemDetailsHTML(node.systems);
    setDetailContent({
      title: `${columnLabels[allColumns.indexOf(node.category)]}: ${node.name}`,
      content
    });
    setShowDetailModal(true);
  }, [allColumns, columnLabels, generateSystemDetailsHTML]);

  const showLinkDetails = useCallback((link) => {
    const content = generateSystemDetailsHTML(link.systems);
    
    setDetailContent({
      title: `(${link.source.category}:${link.source.name}) ↔ (${link.target.category}:${link.target.name})`,
      content
    });
    setShowDetailModal(true);
  }, [generateSystemDetailsHTML]);

  // Form and interaction handlers
  const handleColumnToggle = (column) => {
    const newVisibleColumns = visibleColumns.includes(column)
      ? visibleColumns.filter(col => col !== column)
      : [...visibleColumns, column];
    
    if (newVisibleColumns.length < 2) {
      alert('At least 2 columns must be visible');
      return;
    }
    
    setVisibleColumns(newVisibleColumns);
  };

  const handleColumnReorder = useCallback((draggedColumn, targetColumn) => {
    if (draggedColumn && draggedColumn !== targetColumn) {
      const newColumns = [...visibleColumns];
      const draggedIndex = newColumns.indexOf(draggedColumn);
      const targetIndex = newColumns.indexOf(targetColumn);
      
      // Remove dragged column from its current position
      newColumns.splice(draggedIndex, 1);
      
      // Insert it at the target position
      newColumns.splice(targetIndex, 0, draggedColumn);
      
      setVisibleColumns(newColumns);
    }
  }, [visibleColumns]);

  const drawSankey = useCallback(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    if (filteredData.length === 0) {
      svg.append('text')
        .attr('x', '50%')
        .attr('y', '50%')
        .attr('text-anchor', 'middle')
        .text(loading ? 'Loading data...' : (error || 'No data to display.'));
      return;
    }

    // Calculate available viewport height dynamically
    const headerHeight = 80; // Approximate height of title
    const controlsHeight = 60; // Height of control buttons
    const filtersHeight = 60; // Height of filter section
    const statsHeight = 40; // Height of stats section
    const padding = 40; // Extra padding

    const availableHeight = window.innerHeight - headerHeight - controlsHeight - filtersHeight - statsHeight - padding;
    
    // Get container dimensions for responsiveness
    const containerWidth = containerRef.current ? containerRef.current.clientWidth - 40 : 1200;
    const width = Math.max(800, containerWidth);
    const height = Math.max(500, availableHeight); // Minimum height of 400px
    const margin = { top: 60, right: 80, bottom: 0, left: 100 };

    // Update SVG dimensions
    svg.attr('width', width).attr('height', height);

    // Create zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.5, 3])
      .on('zoom', function(event) {
        mainGroup.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create main group for zooming/panning
    const mainGroup = svg.append('g').attr('class', 'main-group');

    // Set default zoom level (zoomed out) - must be after mainGroup is created
    const defaultScale = 1; // Adjust this value (0.5 = very zoomed out, 1.0 = normal, 1.5 = zoomed in)
    const panX = -75;  // Positive = pan right, negative = pan left
    const panY = -25;   // Positive = pan down, negative = pan up
    const defaultTransform = d3.zoomIdentity
      .translate(panX, panY)
      .scale(defaultScale);
    svg.call(zoom.transform, defaultTransform);

    const graph = createSankeyData(filteredData);
    currentGraph.current = graph;
    
    const nodeWidth = 15;
    const availableWidth = width - margin.left - margin.right;
    const columnWidth = availableWidth / Math.max(1, visibleColumns.length - 1);
    
    // Position nodes with proper alignment
    visibleColumns.forEach((column, columnIndex) => {
      const nodesInColumn = graph.nodes.filter(n => n.category === column);
      const totalHeight = height - margin.top - margin.bottom;
      
      const nodeHeight = 20;
      const numNodes = nodesInColumn.length;

      // Compute dynamic padding so nodes + padding fills the column
      const totalNodeSpace = numNodes * nodeHeight;
      const nodePadding = numNodes > 1
        ? (totalHeight - totalNodeSpace) / (numNodes - 1)
        : 0;

      nodesInColumn.forEach((node, nodeIndex) => {
        node.x = margin.left + (visibleColumns.length === 1 ? 0 : columnIndex * columnWidth);
        node.y = margin.top + nodeIndex * (nodeHeight + nodePadding);
        node.height = nodeHeight;  // ← uniform height
        node.width = nodeWidth;        
      });
    });

    // Add column labels (inside the zoomable group) - make them draggable
    const columnLabelsGroup = mainGroup.append('g').attr('class', 'column-labels');
    
    visibleColumns.forEach((column, columnIndex) => {
      const labelX = margin.left + (visibleColumns.length === 1 ? 0 : columnIndex * columnWidth) + nodeWidth / 2;
      const labelY = margin.top - 20;
      
      const labelGroup = columnLabelsGroup.append('g')
        .attr('class', 'column-label-group')
        .style('cursor', 'move');
      
      // Background rectangle for better drag target
      labelGroup.append('rect')
        .attr('x', labelX - 50)
        .attr('y', labelY - 15)
        .attr('width', 100)
        .attr('height', 25)
        .attr('fill', 'transparent')
      
      labelGroup.append('text')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .style('font-weight', '800')
        .text(columnLabels[allColumns.indexOf(column)]);
      
      // Add drag functionality to the label group with proper positioning
      labelGroup
        .call(d3.drag()
          .on('start', function (event) {
            draggedElement.current = column;
            d3.select(this).style('opacity', 0.7);
            d3.select(this).attr('data-start-x', event.x); // Save actual mouse x
          })
          .on('drag', function (event) {
            const startX = parseFloat(d3.select(this).attr('data-start-x')) || event.x;
            const deltaX = event.x - startX;
            
            // Move the label
            d3.select(this).attr('transform', `translate(${deltaX}, 0)`);
            
            // Move the entire column (nodes and their labels)
            const columnNodes = graph.nodes.filter(n => n.category === column);
            columnNodes.forEach((node, nodeIndex) => {
              const nodeElement = d3.select(`[data-node-id="${graph.nodes.indexOf(node)}"]`);
              const nodeGroup = nodeElement.node().parentNode;
              d3.select(nodeGroup).attr('transform', `translate(${deltaX}, 0)`);
            });
            
            // Redraw links connected to this column with updated positions
            graph.links.forEach((link, linkIndex) => {
              if (link.source.category === column || link.target.category === column) {
                const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
                
                // Calculate new path with offset
                let source = link.source;
                let target = link.target;
                
                if (link.source.category === column) {
                  source = { ...link.source, x: link.source.x + deltaX };
                }
                if (link.target.category === column) {
                  target = { ...link.target, x: link.target.x + deltaX };
                }
                
                const newPath = createLinkPath(source, target);
                linkElement.attr('d', newPath);
              }
            });
          })
          .on('end', function (event) {
            const startX = parseFloat(d3.select(this).attr('data-start-x'));
            const deltaX = event.x - startX;
            const originalIndex = visibleColumns.indexOf(column);
            
            // Calculate the dragged column's current midpoint position
            const originalMidX = margin.left + originalIndex * columnWidth + columnWidth / 2;
            const draggedMidX = originalMidX + deltaX;

            // Find the target position by checking which column midpoint we've crossed
            let targetIndex = originalIndex;
            let willReorder = false;

            // Create array of column midpoints with their indices
            const columnPositions = visibleColumns.map((col, i) => ({
              column: col,
              index: i,
              midX: margin.left + i * columnWidth + columnWidth / 2
            }));

            // Sort by midpoint position to process left to right
            columnPositions.sort((a, b) => a.midX - b.midX);

            // Find where the dragged midpoint should be inserted
            for (let i = 0; i < columnPositions.length; i++) {
              const pos = columnPositions[i];
              
              // Skip the dragged column itself
              if (pos.index === originalIndex) continue;
              
              if (draggedMidX < pos.midX) {
                // The dragged column should be inserted before this position
                targetIndex = pos.index;
                willReorder = (targetIndex !== originalIndex);
                break;
              } else if (i === columnPositions.length - 1) {
                // We've passed all columns, insert at the end
                targetIndex = visibleColumns.length - 1;
                willReorder = (targetIndex !== originalIndex);
              }
            }

            // Alternative simpler approach: find closest column midpoint
            if (!willReorder) {
              let minDistance = Infinity;
              let closestIndex = originalIndex;
              
              for (let i = 0; i < visibleColumns.length; i++) {
                if (i === originalIndex) continue;
                
                const columnMidX = margin.left + i * columnWidth + columnWidth / 2;
                const distance = Math.abs(draggedMidX - columnMidX);
                
                if (distance < minDistance && distance < columnWidth / 2) {
                  minDistance = distance;
                  closestIndex = i;
                  
                  // Determine if we should insert before or after this column
                  if (draggedMidX < columnMidX) {
                    // Insert before this column
                    targetIndex = i;
                  } else {
                    // Insert after this column
                    targetIndex = i + 1;
                    if (targetIndex > originalIndex) targetIndex--; // Adjust for removal
                  }
                  willReorder = true;
                }
              }
            }

            // Smooth animated transition back to final positions
            const transitionDuration = willReorder ? 350 : 200;
            
            // Animate label back to position
            d3.select(this)
              .transition()
              .duration(transitionDuration)
              .ease(d3.easeQuadOut)
              .style('opacity', 1)
              .attr('transform', null);

            // Animate column nodes back to position
            const columnNodes = graph.nodes.filter(n => n.category === column);
            columnNodes.forEach((node, nodeIndex) => {
              const nodeElement = d3.select(`[data-node-id="${graph.nodes.indexOf(node)}"]`);
              const nodeGroup = nodeElement.node().parentNode;
              
              // Animate node group transform back to original position
              d3.select(nodeGroup)
                .transition()
                .duration(transitionDuration)
                .ease(d3.easeQuadOut)
                .attr('transform', null);
            });
            
            // Execute reorder if crossing occurred
            if (willReorder) {
              setTimeout(() => {
                // Create new column order
                const newColumns = [...visibleColumns];
                
                // Remove the dragged column from its current position
                newColumns.splice(originalIndex, 1);
                
                // Adjust target index if we removed an item before it
                const adjustedTargetIndex = targetIndex > originalIndex ? targetIndex - 1 : targetIndex;
                
                // Ensure target index is within bounds
                const finalTargetIndex = Math.max(0, Math.min(adjustedTargetIndex, newColumns.length));
                
                // Insert the column at the new position
                newColumns.splice(finalTargetIndex, 0, column);
                
                // Update the visible columns state
                setVisibleColumns(newColumns);
              }, 50);
            } else {
              // If not reordering, just fix the links after animation
              setTimeout(() => {
                // Redraw all links to ensure they're properly positioned
                graph.links.forEach((link, linkIndex) => {
                  const linkElement = d3.select(`[data-link-id="${linkIndex}"]`);
                  linkElement.attr('d', createLinkPath(link.source, link.target));
                });
              }, transitionDuration);
            }

            draggedElement.current = null;
          })
        );
      });

    // Add vertical dotted line before role-digital column
    const roleDigitalIndex = visibleColumns.indexOf('role-digital');
    if (roleDigitalIndex > 0) {
      const lineX = margin.left + (roleDigitalIndex - 0.4) * columnWidth;
      mainGroup.append('line')
        .attr('x1', lineX)
        .attr('x2', lineX)
        .attr('y1', margin.top)
        .attr('y2', height - margin.bottom)
        .attr('stroke', '#666666')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,4')
        .style('opacity', 0.7);
    }

    const colorScale = d3.scaleOrdinal()
      .domain(visibleColumns)
      .range(['#bbbbbb']);

    // Create tooltip
    const tooltip = d3.select('body')
      .selectAll('.tooltip')
      .data([0])
      .join('div')
      .attr('class', 'tooltip')
      .classed('tooltip', true)

    // Draw links
    const linkGroup = mainGroup.append('g').attr('class', 'links');
    
    graph.links.forEach((link, linkIndex) => {
      linkGroup.append('path')
        .attr('class', 'link')
        .attr('data-link-id', linkIndex)
        .attr('d', createLinkPath(link.source, link.target))
        .attr('stroke', colorScale(link.source.category))
        .attr('stroke-width', Math.max(2, link.value * 2))
        .attr('fill', 'none')
        .style('opacity', 0.5)
        .style('cursor', 'pointer')
        .on('mouseover', function(event) {
          highlightCompleteFlows(link.systems);
          tooltip
            .style('opacity', 1)
            .html(`<strong>Flow: ${link.source.name} → ${link.target.name}</strong><br/>Systems: ${link.value}<br/>Click to explore connections`)
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', function() {
          resetHighlighting();
          tooltip.style('opacity', 0);
        })
        .on('click', function() {
          showLinkDetails(link);
        });
    });

    // Draw nodes
    const nodeGroup = mainGroup.append('g').attr('class', 'nodes');
    
    graph.nodes.forEach((node, nodeIndex) => {
      if (visibleColumns.indexOf(node.category) === -1) return;
      
      const nodeElement = nodeGroup.append('g').attr('class', 'node');

      nodeElement.append('rect')
        .attr('data-node-id', nodeIndex)
        .attr('x', node.x)
        .attr('y', node.y)
        .attr('width', node.width)
        .attr('height', node.height)
        .attr('fill', colorScale(node.category))
        .style('cursor', 'pointer')
        .on('mouseover', function(event) {
          highlightCompleteFlows(node.systems);
          tooltip
            .style('opacity', 1)
            .html(`<strong>${node.name}</strong><br/>Category: ${node.category}<br/>Connected systems: ${node.value}<br/>Click to explore`)
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', function() {
          resetHighlighting();
          tooltip.style('opacity', 0);
        })
        .on('click', function() {
          showNodeDetails(node);
        });

      // Add node labels with proper positioning
      nodeElement.append('text')
        .attr('class', 'node-text')
        .attr('x', node.x + node.width + 5)
        .attr('y', node.y + node.height / 2)
        .attr('dy', '0.35em')
        .style('font-size', '10px')
        .style('pointer-events', 'none')
        .text(node.name.length > 25 ? node.name.substring(0, 25) + '...' : node.name);
    });

    // Add zoom controls
    const zoomControls = svg.append('g')
      .attr('class', 'zoom-controls')
      .attr('transform', `translate(${width}, 0)`);

    // Zoom in button
    zoomControls.append('rect')
      .classed('zoom-button', true)
      .on('click', function() {
        svg.transition().duration(200).call(
          zoom.translateBy, 0, 0
        ).transition().duration(200).call(
          zoom.scaleBy, 1.2
        );
      });

    zoomControls.append('text')
      .classed('zoom-button-text', true)
      .attr('y', 17)
      .text('+');

    // Zoom out button
    zoomControls.append('rect')
      .classed('zoom-button', true)
      .attr('y', 30)
      .on('click', function() {
        svg.transition().duration(200).call(
          zoom.translateBy, 0, 0
        ).transition().duration(200).call(
          zoom.scaleBy, 0.8
        );
      });

    zoomControls.append('text')
      .classed('zoom-button-text', true)
      .attr('y', 47)
      .text('−');

    // Reset zoom button
    zoomControls.append('rect')
      .classed('zoom-button', true)
      .classed('zoom-button-reset', true)
      .attr('y', 60)
      .on('click', function() {
        svg.transition().duration(200).call(zoom.transform, defaultTransform);
      });

    zoomControls.append('text')
      .classed('zoom-button-text', true)
      .attr('y', 77)
      .text('⌂');

  }, [filteredData, visibleColumns, createSankeyData, showLinkDetails, showNodeDetails, loading, error, allColumns, columnLabels, handleColumnReorder]);

  // Effects - Only load data once on mount
  useEffect(() => {
    loadFromAirtable();
  }, []); // Empty dependency array - only runs once on mount

  useEffect(() => {
    const filtered = data.filter(d => {
      const organismMatch = !filters.organism || 
        (Array.isArray(d.organism) ? d.organism.includes(filters.organism) : false);
      const scaleMatch = !filters.scale || 
        (Array.isArray(d.scale) ? d.scale.includes(filters.scale) : false);
      const temporalityMatch = !filters.temporality || 
        (Array.isArray(d.temporality) ? d.temporality.includes(filters.temporality) : false);
      
      return organismMatch && scaleMatch && temporalityMatch;
    });
    setFilteredData(filtered);
  }, [data, filters]);

  useEffect(() => {
    drawSankey();
  }, [drawSankey]);

  // Responsive resize handler
  useEffect(() => {
    const handleResize = () => {
      drawSankey();
    };

    window.addEventListener('resize', handleResize);
    // Also listen for orientation changes on mobile
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [drawSankey]);

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    const newEntry = {
      name: formData.get('name'),
      organism: formData.get('organism'),
      gmo: formData.get('gmo') === 'on',
      trigger: formData.get('trigger'),
      output: formData.get('output'),
      scale: formData.get('scale'),
      temporality: formData.get('temporality'),
      'role-organism': formData.get('role-organism'),
      'role-digital': formData.get('role-digital')
    };
    
    const success = await addToAirtable(newEntry);
    if (success) {
      alert('New bio-digital system added successfully!');
      setShowModal(false);
      e.target.reset();
    } else {
      alert('Failed to add system.');
    }
  };

  // Utility Functions
  const resetView = () => {
    setFilters({ organism: '', scale: '', temporality: '' });
    setVisibleColumns([...allColumns]);
  };

  const exportData = () => {
    const exportObject = {
      data: data,
      visibleColumns: visibleColumns,
      timestamp: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(exportObject, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'bio-digital-systems.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const refreshData = () => {
    loadFromAirtable();
  };

  // Computed Values with proper ordering
  const getOrderedValues = (data, field, column) => {
    let uniqueValues = [...new Set(data.flatMap(d => d[field] || []))];
    
    // Apply the same ordering logic as in createSankeyData
    if (column === 'temporality') {
      const timeUnits = ['second', 'minute', 'hour', 'day', 'week'];
      
      uniqueValues.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        
        const aUnitIndex = timeUnits.findIndex(unit => aLower.includes(unit));
        const bUnitIndex = timeUnits.findIndex(unit => bLower.includes(unit));
        
        if (aUnitIndex === bUnitIndex && aUnitIndex !== -1) {
          const aHasLessOrEqual = aLower.includes('<') || aLower.includes('≤');
          const bHasLessOrEqual = bLower.includes('<') || bLower.includes('≤');
          const aHasGreater = aLower.includes('>') && !aHasLessOrEqual;
          const bHasGreater = bLower.includes('>') && !bHasLessOrEqual;
          
          if (aHasLessOrEqual && bHasGreater) return -1;
          if (bHasLessOrEqual && aHasGreater) return 1;
          
          return a.localeCompare(b);
        }
        
        if (aUnitIndex === bUnitIndex) {
          return a.localeCompare(b);
        }
        
        if (aUnitIndex === -1) return 1;
        if (bUnitIndex === -1) return -1;
        
        return aUnitIndex - bUnitIndex;
      });
    } else if (column === 'scale') {
      const scaleUnits = ['cell', 'organism', 'population', 'ecosystem'];
      
      uniqueValues.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        
        const aUnitIndex = scaleUnits.findIndex(unit => aLower.includes(unit));
        const bUnitIndex = scaleUnits.findIndex(unit => bLower.includes(unit));
        
        if (aUnitIndex === bUnitIndex) {
          return a.localeCompare(b);
        }
        
        if (aUnitIndex === -1) return 1;
        if (bUnitIndex === -1) return -1;
        
        return aUnitIndex - bUnitIndex;
      });
    } else {
      uniqueValues.sort();
    }
    
    return uniqueValues;
  };

  const uniqueOrganisms = getOrderedValues(data, 'organism', 'organism');
  const uniqueScales = getOrderedValues(data, 'scale', 'scale');
  const uniqueTemporalities = getOrderedValues(data, 'temporality', 'temporality');

  // Component render
  return (
    <div className="app-container" ref={containerRef}>
      <h1 className="app-title">Bio-Digital Systems Flow Explorer</h1>
      
      {error && (
        <div className="error-message">
          <p>⚠️ {error}</p>
          <button className="btn" onClick={refreshData}>Retry Connection</button>
        </div>
      )}
      
      {/* Controls */}
      <div className="controls">
        <button className="btn" onClick={() => setShowModal(true)} disabled={loading}>
          Add New System
        </button>
        <button className="btn" onClick={resetView}>
          Reset View
        </button>
        <button className="btn" onClick={exportData}>
          Export Data
        </button>
        <button className="btn" onClick={refreshData}>
          Refresh Data
        </button>
      </div>

      {/* Filters */}
      <div className="filter-section">
        <div className="filter-group">
          <label>Filter by Organism:</label>
          <select 
            className="filter-select"
            value={filters.organism} 
            onChange={(e) => setFilters(prev => ({ ...prev, organism: e.target.value }))}
          >
            <option value="">All Organisms</option>
            {uniqueOrganisms.map(organism => (
              <option key={organism} value={organism}>{organism}</option>
            ))}
          </select>
          
          <label>Filter by Scale:</label>
          <select 
            className="filter-select"
            value={filters.scale} 
            onChange={(e) => setFilters(prev => ({ ...prev, scale: e.target.value }))}
          >
            <option value="">All Scales</option>
            {uniqueScales.map(scale => (
              <option key={scale} value={scale}>{scale}</option>
            ))}
          </select>
          
          <label>Filter by Temporality:</label>
          <select 
            className="filter-select"
            value={filters.temporality} 
            onChange={(e) => setFilters(prev => ({ ...prev, temporality: e.target.value }))}
          >
            <option value="">All Temporalities</option>
            {uniqueTemporalities.map(temporality => (
              <option key={temporality} value={temporality}>{temporality}</option>
            ))}
          </select>
        </div>
        
        {/* Column Controls */}
        <div className="column-controls">
          <h4>Show/Hide Categories:</h4>
          <div className="column-control-group">
            {allColumns.map((column, index) => (
              <div key={column} className="column-toggle">
                <input 
                  type="checkbox" 
                  checked={visibleColumns.includes(column)}
                  onChange={() => handleColumnToggle(column)}
                />
                <label>{columnLabels[index]}</label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Diagram */}
      <div className="diagram-container">
        <svg 
          ref={svgRef} 
          className="diagram-svg"
        />
      </div>

      {/* Statistics */}
      <div className="stats">
        Stats: {filteredData.length} Total Systems, {uniqueOrganisms.length} Unique Organisms
      </div>

      {/* Add New System Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">Add New Bio-Digital System</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                &times;
              </button>
            </div>
            
            <form onSubmit={handleFormSubmit}>
              <div className="form-group">
                <label className="form-label">Project Title:</label>
                <input 
                  type="text" 
                  name="name" 
                  required
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Organism:</label>
                <input 
                  type="text" 
                  name="organism" 
                  required
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Genetically Modified?</label>
                <input
                  type="checkbox"
                  name="gmo"
                  className="form-input"
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Trigger:</label>
                <select name="trigger" required className="form-select">
                  <option value="">Select trigger type</option>
                  <option value="Electrical">Electrical</option>
                  <option value="Optical">Optical</option>
                  <option value="Touch">Touch</option>
                  <option value="Chemical">Chemical</option>
                  <option value="Food">Food</option>
                  <option value="Multiple">Multiple</option>
                </select>
              </div>
              
              <div className="form-group">
                <label className="form-label">Observable Output:</label>
                <select name="output" required className="form-select">
                  <option value="">Select output type</option>
                  <option value="Electrical">Electrical</option>
                  <option value="Optical">Optical</option>
                  <option value="Chemical">Chemical</option>
                  <option value="Growth">Growth</option>
                  <option value="Mechanical">Mechanical</option>
                  <option value="Thermal">Thermal</option>
                </select>
              </div>
              
              <div className="form-group">
                <label className="form-label">Scale:</label>
                <select name="scale" required className="form-select">
                  <option value="">Select scale</option>
                  <option value="(Sub)cellular">(Sub)cellular</option>
                  <option value="Organism">Organism</option>
                  <option value="Population">Population</option>
                </select>
              </div>
              
              <div className="form-group">
                <label className="form-label">Temporality:</label>
                <select name="temporality" required className="form-select">
                  <option value="≤ 1 second">≤1 second</option>
                  <option value="≤ 1 minute">≤1 minute</option>
                  <option value="≤ 1 hour">≤1 hour</option>
                  <option value="≤ 1 day">≤1 day</option>
                  <option value="≤ 1 week">≤1 week</option>
                  <option value="> 1 week">more than 1 week</option>
                </select>
              </div>
              
              <div className="form-group">
                <label className="form-label">Role of Organism for Digital Component:</label>
                <select name="role-organism" required className="form-select">
                  <option value="">Select organism role</option>
                  <option value="Input">Input</option>
                  <option value="Output">Output</option>
                  <option value="Power">Power</option>
                  <option value="Memory/State">Memory/State</option>
                  <option value="Comparison/Evaluation">Comparison/Evaluation</option>
                  <option value="Selection/Routing">Selection/Routing</option>
                  <option value="Transformation">Transformation</option>
                  <option value="Adaptation/Plasticity">Adaptation/Plasticity</option>
                </select>
              </div>
              
              <div className="form-group">
                <label className="form-label">Role of Digital for Organism:</label>
                <select name="role-digital" required className="form-select">
                  <option value="">Select digital role</option>
                  <option value="Stimulation">Stimulation</option>
                  <option value="Interpretation">Interpretation</option>
                  <option value="Amplification">Amplification</option>
                  <option value="Maintenance">Maintenance</option>
                </select>
              </div>
              
              <div className="form-group">
                <button type="submit" className="btn">
                  Add System
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">{detailContent.title}</h2>
              <button className="modal-close" onClick={() => setShowDetailModal(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body" dangerouslySetInnerHTML={{ __html: detailContent.content }} />
          </div>
        </div>
      )}
    </div>
  );
};

export default BioDigitalSankeyApp;