import uiautomator2 as u2

try:
    print("Connecting to 192.168.1.58:5555...")
    d = u2.connect("192.168.1.58:5555")
    
    print("Device Info:", d.info)
    
    print("Pushing termux_mcp_server.mjs to device...")
    d.push("d:/code/闲鱼/testCode/termux_mcp_server.mjs", "/sdcard/Download/termux_mcp_server.mjs")
    
    print("Push successful!")
except Exception as e:
    print(f"Error: {e}")
