const fs = require('fs');
const path = require('path');
const appJsonPath = path.join(process.cwd(), 'app.json');

if (!fs.existsSync(appJsonPath)) {
  console.error('No app.json found. Aborting.');
  process.exit(1);
}

const raw = fs.readFileSync(appJsonPath, 'utf8');
let json;
try { json = JSON.parse(raw); } catch (e) {
  console.error('app.json is not valid JSON. Aborting.'); process.exit(1);
}

json.expo = json.expo || {};
json.expo.icon = "./assets/brand/app-icon.png";
json.expo.splash = {
  image: "./assets/brand/logo.png",
  resizeMode: "contain",
  backgroundColor: "#0B132B"
};

fs.writeFileSync(appJsonPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
console.log('✅ Updated app.json with brand icon & splash.');
