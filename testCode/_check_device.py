import subprocess
import sys

# Try ADB connect
result = subprocess.run(['adb', 'connect', '192.168.1.58:5555'], capture_output=True, text=True, timeout=10)
print('STDOUT:', result.stdout)
print('STDERR:', result.stderr)

# Check devices
result2 = subprocess.run(['adb', 'devices'], capture_output=True, text=True, timeout=10)
print('Devices:', result2.stdout)
