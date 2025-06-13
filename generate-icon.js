const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// Create a simple icon for the application
function generateIcon() {
  // Create a canvas for the icon (256x256 pixels)
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  
  // Fill background with gradient
  const gradient = ctx.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, '#000000');
  gradient.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  
  // Add glass effect
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0, Math.PI * 2);
  ctx.fill();
  
  // Add purple accent
  ctx.fillStyle = '#c084fc';
  ctx.beginPath();
  ctx.arc(128, 128, 80, 0, Math.PI * 2);
  ctx.fill();
  
  // Add inner glass effect
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(128, 128, 60, 0, Math.PI * 2);
  ctx.fill();
  
  // Add text "D" for DuggAi
  ctx.font = 'bold 120px Inter, sans-serif';
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('D', 128, 128);
  
  // Save the icon as PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, 'icon.png'), buffer);
  
  console.log('Icon generated successfully!');
}

// Run the function
generateIcon();
