const fs = require('fs');
const path = 'c:\\Users\\Jose\\Downloads\\generate_manual_final.py';
let content = fs.readFileSync(path, 'utf8');

const regex = /r'C:\\Users\\Jose\\AppData\\Local\\hermes\\cache\\screenshots\\browser_screenshot_[^']+\.png'/g;

let count = 1;
content = content.replace(regex, () => {
    const newPath = `r'C:\\Users\\Jose\\Downloads\\manual_v2_extracted\\word\\media\\image${count}.png'`;
    count++;
    return newPath;
});

content = content.replace("doc.save('manual de usuario niche.docx')", "doc.save('C:\\\\Users\\\\Jose\\\\Downloads\\\\manual_de_usuario_niche_PERFECTO.docx')");

fs.writeFileSync('c:\\Users\\Jose\\Downloads\\generate_manual_perfecto.py', content, 'utf8');
console.log('Done!');
