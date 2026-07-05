"""
检查平板是否重新上线，以及代理是否生效
"""
import uiautomator2 as u2
import time

print("等待平板重新上线...")
for i in range(60):
    try:
        d = u2.connect("192.168.1.58")
        info = d.info
        print(f"✅ 重连成功! {info.get('productName','?')}")
        r = d.shell(["settings", "get", "global", "http_proxy"])
        print(f"代理: {r.output.strip()}")
        break
    except Exception as e:
        if i % 5 == 0:
            print(f"  等待中... ({i}s)")
        time.sleep(1)
else:
    print("❌ 平板60秒未上线")
