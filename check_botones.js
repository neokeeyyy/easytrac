const fs = require('fs');
const path = 'src/20-acs.js';
let content = fs.readFileSync(path, 'utf8');

// Check what the actual line looks like around BOTONES.inicio
const idx = content.indexOf('inicio:');
if (idx !== -1) {
  // Find the BOTONES object's inicio line
  const botonIdx = content.indexOf('var BOTONES');
  if (botonIdx !== -1) {
    const slice = content.substring(botonIdx, botonIdx + 400);
    console.log('BOTONES section:', JSON.stringify(slice.substring(0, 300)));
  }
}
