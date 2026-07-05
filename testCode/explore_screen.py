"""
查看平板当前屏幕状态
"""
import uiautomator2 as u2
import re

d = u2.connect('192.168.1.58')

# Dump current screen
xml = d.dump_hierarchy()

# Find clickable elements with text
elements = []
for line in xml.split('<'):
    if 'text=' in line:
        m = re.search(r'text="([^"]+)"', line)
        if m and m.group(1).strip():
            elements.append(m.group(1).strip())

print('当前屏幕可见元素:')
for e in elements[:40]:
    print(f'  - {e}')
print(f'\n...共 {len(elements)} 个文本元素')

# Also find clickable elements
print('\n可点击元素:')
buttons = d(clickable=True)
for btn in buttons:
    text = btn.info.get('text', '')
    if text:
        print(f'  [{btn.info.get("className","").split(".")[-1]}] {text}')
