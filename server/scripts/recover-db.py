import sqlite3
import json

def extract():
    conn = sqlite3.connect(r'c:\Users\Jose\Downloads\niche-domicilios\server\prisma\dev.db')
    c = conn.cursor()
    
    c.execute("SELECT name, price, categoryId FROM menu_items;")
    items = c.fetchall()
    
    c.execute("SELECT id, name FROM menu_categories;")
    cats = c.fetchall()
    cat_map = {row[0]: row[1] for row in cats}
    
    results = []
    for item in items:
        results.append({
            'name': item[0],
            'price': item[1],
            'category': cat_map.get(item[2], 'Unknown')
        })
        
    with open(r'c:\Users\Jose\Downloads\niche-domicilios\server\scripts\recovered_menu.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
        
extract()
