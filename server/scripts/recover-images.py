import sqlite3
import json

def extract_images():
    conn = sqlite3.connect(r'c:\Users\Jose\Downloads\niche-domicilios\server\prisma\dev.db')
    c = conn.cursor()
    
    c.execute("SELECT name, image FROM menu_items WHERE image IS NOT NULL AND image != '';")
    items = c.fetchall()
    
    results = []
    for item in items:
        results.append({
            'name': item[0],
            'image': item[1]
        })
        
    with open(r'c:\Users\Jose\Downloads\niche-domicilios\server\scripts\recovered_images.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
        
extract_images()
