"""
从平板测试代理连通性
"""
import uiautomator2 as u2

d = u2.connect("192.168.1.58")

# Test 1: Check proxy setting
print("=== 代理设置 ===")
result = d.shell(["settings", "get", "global", "http_proxy"])
print(f"http_proxy: {result.output.strip()}")

# Test 2: Try to use curl/wget from tablet to test proxy
# Android devices often have curl or wget
print("\n=== 从平板测试代理 ===")
result = d.shell(["curl", "-x", "http://192.168.1.102:8890", 
                   "--connect-timeout", "5",
                   "http://httpbin.org/ip"])
if result.exit_code == 0:
    print(f"curl 测试: ✅ 成功")
    print(f"  输出: {result.output[:200]}")
elif "not found" in result.stderr.lower():
    print("curl 不可用，尝试 wget...")
    result2 = d.shell(["wget", "-q", "-O", "-", 
                        "-e", "use_proxy=yes", 
                        "-e", "http_proxy=192.168.1.102:8890",
                        "http://httpbin.org/ip"])
    print(f"wget 测试: {'✅ 成功' if result2.exit_code == 0 else '❌ 失败'}")
    if result2.output:
        print(f"  输出: {result2.output[:200]}")
else:
    print(f"  exit_code={result.exit_code}")
    print(f"  output: {result.output[:200]}")
    print(f"  stderr: {result.stderr[:200]}")

# Test 3: Check if the AMDC connections are going through
print("\n=== 网络连接检查 ===")
result = d.shell(["netstat", "-n"])
if result.output:
    for line in result.output.split("\n"):
        if "192.168.1.102" in line:
            print(f"  到本机连接: {line.strip()}")

# Test 4: Alternative - use uiautomator2 to navigate to a test page
print("\n=== 域名解析测试 ===")
result = d.shell(["ping", "-c", "1", "-W", "2", "192.168.1.102"])
print(f"ping 本机: {'✅ 可达' if result.exit_code == 0 else '❌ 不可达'}")
if result.output:
    for line in result.output.split("\n"):
        if "ttl=" in line or "time=" in line:
            print(f"  {line}")

print("\n=== 结论 ===")
result = d.shell(["settings", "get", "global", "http_proxy"])
has_proxy = "192.168.1.102" in result.output
print(f"代理已设置: {'✅' if has_proxy else '❌'}")
print(f"代理地址: {result.output.strip() or '(无)'}")
