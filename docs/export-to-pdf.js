/**
 * Script genérico para exportar archivos Markdown con diagramas Mermaid a PDF
 * 
 * Usage: node export-to-pdf.js <nombre-archivo>
 * Ejemplo: node export-to-pdf.js DATABASE_SCHEMA.md
 * 
 * El archivo debe existir en la carpeta origin/
 * El PDF se generará en la carpeta export/
 * 
 * Prerequisites:
 * pnpm install (en la carpeta documentation)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Obtener el nombre del archivo desde los argumentos de línea de comandos
const fileName = process.argv[2];

if (!fileName) {
  console.error('❌ Error: Debes proporcionar el nombre del archivo');
  console.log('\nUsage: node export-to-pdf.js <nombre-archivo>');
  console.log('Ejemplo: node export-to-pdf.js DATABASE_SCHEMA.md');
  process.exit(1);
}

// Validar que el archivo tenga extensión .md
const fileBaseName = fileName.endsWith('.md') ? fileName.replace('.md', '') : fileName;
const inputFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;

const INPUT_FILE = path.join(__dirname, 'origin', inputFileName);
const EXPORT_DIR = path.join(__dirname, 'export');
const OUTPUT_FILE = path.join(EXPORT_DIR, `${fileBaseName}.pdf`);
const TEMP_DIR = path.join(EXPORT_DIR, `.${fileBaseName.toLowerCase()}-temp`);

// Crear directorio de exportación si no existe
if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

// Crear directorio temporal
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function extractMermaidDiagrams(content) {
  // Regex mejorado para coincidir con bloques mermaid con diferentes terminaciones de línea
  const mermaidRegex = /```mermaid\s*\n([\s\S]*?)\n```/g;
  const diagrams = [];
  const matches = [];
  let match;
  let index = 0;
  
  // Primero, encontrar todas las coincidencias
  while ((match = mermaidRegex.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      diagramCode: match[1].trim(),
      index: index++
    });
  }
  
  console.log(`Found ${matches.length} Mermaid diagrams to convert`);
  
  let modifiedContent = content;
  const https = require('https');
  
  // Procesar cada diagrama de forma secuencial para evitar problemas de concurrencia
  for (const matchData of matches) {
    const { diagramCode, index, fullMatch } = matchData;
    const diagramFile = path.join(TEMP_DIR, `diagram-${index}.mmd`);
    const imageFile = path.join(TEMP_DIR, `diagram-${index}.png`);
    
    // Guardar código Mermaid en archivo
    fs.writeFileSync(diagramFile, diagramCode);
    
    // Convertir a PNG usando API de Mermaid (sin Puppeteer)
    const MAX_RETRIES = 3;
    let success = false;
    for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
      try {
        // Codificar el diagrama para la URL (usar encodeURIComponent para seguridad)
        const encodedDiagram = Buffer.from(diagramCode).toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');

        // Usar la API de Mermaid para generar la imagen
        const mermaidApiUrl = `https://mermaid.ink/img/${encodedDiagram}?theme=default&bgColor=white`;

        console.log(`  📊 Converting diagram ${index} via Mermaid API (attempt ${attempt}/${MAX_RETRIES})...`);

        // Descargar la imagen desde la API de forma asíncrona
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(imageFile);

          https.get(mermaidApiUrl, (response) => {
            if (response.statusCode === 200) {
              response.pipe(file);
              file.on('finish', () => {
                file.close();

                // Leer imagen y convertir a base64 para incrustar
                const imageBuffer = fs.readFileSync(imageFile);
                const base64Image = imageBuffer.toString('base64');
                // Check if it's a pie chart and make it smaller
                const isPieChart = diagramCode.trim().toLowerCase().startsWith('pie');
                const imageStyle = isPieChart
                  ? 'max-width: 150px; height: auto; display: block; margin: 1em auto;'
                  : 'max-width: 60%; height: auto; display: block; margin: 1em auto;';
                const imageMarkdown = `\n<img src="data:image/png;base64,${base64Image}" alt="Mermaid Diagram ${index}" style="${imageStyle}" />\n`;
                modifiedContent = modifiedContent.replace(fullMatch, imageMarkdown);

                diagrams.push({
                  index,
                  diagramFile,
                  imageFile
                });
                console.log(`  ✅ Converted diagram ${index} to image`);
                resolve();
              });
            } else {
              file.close();
              if (fs.existsSync(imageFile)) {
                fs.unlinkSync(imageFile);
              }
              reject(new Error(`API returned status ${response.statusCode}`));
            }
          }).on('error', (err) => {
            file.close();
            if (fs.existsSync(imageFile)) {
              fs.unlinkSync(imageFile);
            }
            reject(err);
          });
        });
        success = true;
      } catch (error) {
        console.error(`  ❌ Error converting diagram ${index} (attempt ${attempt}):`, error.message);
        if (attempt < MAX_RETRIES) {
          const delay = attempt * 2000;
          console.log(`  ⏳ Retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    if (!success) {
      console.error(`  ⚠️  Diagram ${index} skipped after ${MAX_RETRIES} failed attempts`);
    }
  }
  
  return { modifiedContent, diagrams };
}

async function convertToPDF(content) {
  const tempMdFile = path.join(TEMP_DIR, `${fileBaseName}-with-images.md`);
  fs.writeFileSync(tempMdFile, content);
  
  // Buscar Chrome del sistema
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  
  let chromePath = null;
  for (const path of chromePaths) {
    if (fs.existsSync(path)) {
      chromePath = path;
      break;
    }
  }
  
  if (!chromePath) {
    console.error('❌ Chrome/Chromium not found. Please install Google Chrome.');
    console.log('   Or open the markdown file manually and print to PDF.');
    throw new Error('Chrome not found');
  }
  
  console.log(`📄 Converting to PDF using Chrome...`);
  
  // Usar Chrome headless para convertir markdown directamente a PDF
  // Chrome puede leer archivos markdown y convertirlos a PDF
  // Usar un nombre limpio basado en el codename del proyecto
  const codename = fileBaseName.replace('_STATUS', '').replace('STATUS', '');
  // Crear archivo HTML en una ubicación simple con solo el codename
  const cleanHtmlFile = path.join(require('os').tmpdir(), `${codename}.html`);
  
  // Convertir markdown a HTML simple
  const { marked } = require('marked');
  marked.setOptions({ breaks: true, gfm: true });
  let htmlContent = marked.parse(content);
  
  
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${codename}</title>
  <style>
    @page {
      margin: 2.5cm 2.8cm 3cm 2.8cm;
      @top-center {
        content: "${codename}";
        font-size: 9px;
        color: #999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      @bottom-left {
        content: "";
      }
      @bottom-right {
        content: counter(page) " / " counter(pages);
        font-size: 9px;
        color: #999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      @bottom-center {
        content: "";
        border-top: 1px solid #e0e0e0;
        display: block;
      }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; line-height: 1.6; max-width: 100%; margin: 0; padding: 0; color: #333333; }
    img { max-width: 100%; height: auto; }
    pre { background: #f4f4f4; padding: 0.5em; overflow-x: auto; font-size: 11px; }
    code { background: #f4f4f4; padding: 0.1em 0.3em; font-size: 11px; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; margin: 0.5em 0; }
    th, td { border: 1px solid #e0e0e0; padding: 0.3em 0.5em; }
    th { background: #2C3E50; color: #ffffff; font-weight: bold; }
    tbody tr:nth-child(odd) td { background: #ffffff; }
    tbody tr:nth-child(even) td { background: #F5F7FA; }
    td { color: #333333; }
    a { color: #3498DB; text-decoration: none; }
    h1 { font-size: 1.5em; margin: 0.4em 0 0.2em; color: #2C3E50; }
    h2 { font-size: 1.25em; margin: 0.7em 0 0.2em; color: #2C3E50; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.1em; }
    h3 { font-size: 1.05em; margin: 0.5em 0 0.15em; color: #2C3E50; }
    h4, h5, h6 { font-size: 1em; margin: 0.4em 0 0.1em; color: #2C3E50; }
    p { margin: 0.35em 0; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 0.6em 0; }
    ul, ol { margin: 0.2em 0; padding-left: 1.4em; }
    li { margin: 0.1em 0; }
    blockquote { margin: 0.4em 0 0.4em 1em; padding: 0.2em 0.6em; border-left: 3px solid #ccc; color: #555; font-style: italic; }
    .appendix-screenshots { page-break-before: always; }
  </style>
</head>
<body>
${htmlContent}</body>
</html>`;
  
  fs.writeFileSync(cleanHtmlFile, fullHtml);
  
  // Usar Chrome para convertir HTML a PDF con opciones para controlar footer
  execSync(`"${chromePath}" --headless --disable-gpu --print-to-pdf="${OUTPUT_FILE}" --print-to-pdf-no-header "${cleanHtmlFile}"`, {
    stdio: 'inherit',
    cwd: __dirname
  });
  
  // Limpiar archivo HTML temporal
  if (fs.existsSync(cleanHtmlFile)) {
    fs.unlinkSync(cleanHtmlFile);
  }
  
  console.log(`✅ PDF exported successfully to ${OUTPUT_FILE}`);
  return Promise.resolve();
}

// Ejecución principal
console.log(`📄 Reading ${inputFileName} from origin folder...`);
if (!fs.existsSync(INPUT_FILE)) {
  console.error(`❌ Error: ${INPUT_FILE} not found!`);
  console.error(`   Make sure ${inputFileName} exists in the origin/ folder.`);
  process.exit(1);
}
const content = fs.readFileSync(INPUT_FILE, 'utf-8');

console.log('🔄 Extracting and converting Mermaid diagrams...');

// Convertir diagramas de forma asíncrona
extractMermaidDiagrams(content).then(({ modifiedContent, diagrams }) => {
  console.log(`✅ Converted ${diagrams.length} Mermaid diagrams to images`);

  console.log('📄 Converting to PDF...');
  return convertToPDF(modifiedContent);
}).then(() => {
  // Esperar un poco para asegurar que el PDF se escriba, luego limpiar
  setTimeout(() => {
    console.log('🧹 Cleaning up temporary files...');
    try {
      // Eliminar completamente el directorio temporal
      if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        console.log('✅ Temporary files cleaned up successfully');
      }
      console.log('✨ Done! PDF exported with Mermaid diagrams.');
      console.log(`📁 Output file: ${OUTPUT_FILE}`);
    } catch (error) {
      console.error(`⚠️  Warning: Could not clean up temporary files in ${TEMP_DIR}/`);
      console.error(`   Error: ${error.message}`);
      console.log('   You may need to manually delete the temporary directory.');
    }
  }, 1000);
}).catch((error) => {
  console.error('Error:', error);
  // Intentar limpiar incluso si hay error
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  } catch (cleanupError) {
    // Ignorar errores de limpieza
  }
  process.exit(1);
});

