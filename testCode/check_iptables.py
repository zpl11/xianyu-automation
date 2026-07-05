"""
检查平板是否支持 iptables
"""
import uiautomator2 as u2
d = u2.connect("192.168.1.58")

# 测试 iptables
r = d.shell(["iptables", "-L", "-n", "-t", "nat"])
print(f"exit_code: {r.exit_code}")
print(f"output: {str(r.output)[:300]}")
print(f"stderr: {str(r.stderr)[:200]}")

# 如果成功，再试添加规则
if r.exit_code == 0:
    r2 = d.shell(["iptables", "-t", "nat", "-A", "OUTPUT", "-p", "tcp",
                   "--dport", "80", "-j", "DNAT",
                   "--to-destination", "192.168.1.102:8890"])
    print(f"\n添加规则 exit: {r2.exit_code}")
    if r2.exit_code == 0:
        print("✅ iptables 规则添加成功！")
        # 清理
        d.shell(["iptables", "-t", "nat", "-D", "OUTPUT", "-p", "tcp",
                 "--dport", "80", "-j", "DNAT",
                 "--to-destination", "192.168.1.102:8890"])
    else:
        print(f"❌ 添加失败: {str(r2.stderr)[:200]}")
else:
    print("❌ iptables 不可用")
