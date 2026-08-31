const path = require('path');
const fs = require('fs');
const pngToIco = require('png-to-ico');

const src = path.join(__dirname, '..', '..', '..', 'C:\\Users\\Kleber\\.gemini\\antigravity-ide\\brain\\fa5abe0a-4aa8-4d15-91b3-ca1848315ae9\\condobox_icon_1788136137510.jpg');

// Actually let's use the path directly
const iconSrc = 'C:\\Users\\Kleber\\.gemini\\antigravity-ide\\brain\\fa5abe0a-4aa8-4d15-91b3-ca1848315ae9\\condobox_icon_1788136137510.jpg';
const iconOut = path.join(__dirname, '..', 'assets', 'icon.ico');

// Ensure assets dir exists
fs.mkdirSync(path.join(__dirname, '..', 'assets'), { recursive: true });

pngToIco([iconSrc])
  .then(buf => {
    fs.writeFileSync(iconOut, buf);
    console.log('Icon created at:', iconOut);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
