import uiautomator2 as u2
import xml.etree.ElementTree as ET
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

d = u2.connect('192.168.1.58:5555')
print('--- Current Active Elements ---')
xml_str = d.dump_hierarchy()
root = ET.fromstring(xml_str.encode('utf-8'))
for node in root.iter('node'):
    text = node.get('text', '').strip()
    desc = node.get('content-desc', '').strip()
    cls = node.get('class', '')
    if text or desc:
        print(f"[{cls}] TEXT: '{text}' | DESC: '{desc}'")
