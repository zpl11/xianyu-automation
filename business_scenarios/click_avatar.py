import uiautomator2 as u2
import xml.etree.ElementTree as ET
import sys
import re
import time
import argparse
from datetime import datetime

# Configure stdout to use utf-8 to prevent console encoding crashes on Windows
sys.stdout.reconfigure(encoding='utf-8')

def log_action(action_type: str, details: str):
    """Prints a structured, timestamped log entry for debugging and audit trail."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [ACTION:{action_type}] {details}")

def parse_bounds(bounds_str):
    matches = re.findall(r'\[(\d+),(\d+)\]', bounds_str)
    if len(matches) == 2:
        return {
            "x0": int(matches[0][0]), "y0": int(matches[0][1]),
            "x1": int(matches[1][0]), "y1": int(matches[1][1]),
            "cx": (int(matches[0][0]) + int(matches[1][0])) // 2,
            "cy": (int(matches[0][1]) + int(matches[1][1])) // 2
        }
    return None

def clean_text(text: str) -> str:
    """Removes spaces, zero-width spaces, dots, ellipsis, and special characters."""
    return re.sub(r'[\s\u200b\.\u2026]+', '', text)

def is_fuzzy_match(screen_text: str, target: str) -> bool:
    """Checks if screen text and target username match fuzzily (supports truncation & zero-width spaces)."""
    c_screen = clean_text(screen_text)
    c_target = clean_text(target)
    
    if not c_screen or not c_target:
        return False
        
    # 1. Exact or substring match in either direction (handles truncation e.g. "淡青山信" vs "淡青山信息馆")
    if c_target in c_screen or c_screen in c_target:
        return True
        
    # 2. Match first 3 characters if both are reasonably long
    min_len = min(len(c_screen), len(c_target))
    if min_len >= 3:
        if c_screen[:3] == c_target[:3]:
            return True
            
    return False

def find_clickable_container_for_text(root, text_bounds):
    """
    Finds the smallest clickable container that encloses the text bounds.
    This resolves issues where click events are blocked by sibling overlays.
    """
    best_node = None
    best_area = float('inf')
    
    tx0, ty0, tx1, ty1 = text_bounds["x0"], text_bounds["y0"], text_bounds["x1"], text_bounds["y1"]
    
    for node in root.iter('node'):
        attrib = node.attrib
        clickable = attrib.get("clickable") == "true"
        bounds_str = attrib.get("bounds", "")
        
        if clickable and bounds_str:
            b = parse_bounds(bounds_str)
            if b:
                # Check if this container completely encloses the text bounds
                if b["x0"] <= tx0 and b["y0"] <= ty0 and b["x1"] >= tx1 and b["y1"] >= ty1:
                    area = (b["x1"] - b["x0"]) * (b["y1"] - b["y0"])
                    # We want the most specific (smallest) enclosing container (e.g. the user info row, not the whole card)
                    if area < best_area:
                        best_area = area
                        best_node = b
                        
    return best_node

def find_avatar_node_for_username(root, target_text_node):
    """
    Finds the avatar ImageView adjacent to the username TextView.
    """
    t_bounds = parse_bounds(target_text_node.attrib.get("bounds", ""))
    if not t_bounds:
        return None
        
    tx0, ty0, tx1, ty1 = t_bounds["x0"], t_bounds["y0"], t_bounds["x1"], t_bounds["y1"]
    
    best_avatar = None
    min_dist = float('inf')
    
    for node in root.iter('node'):
        class_name = node.attrib.get("class", "")
        if "ImageView" in class_name:
            bounds_str = node.attrib.get("bounds", "")
            if bounds_str:
                b = parse_bounds(bounds_str)
                if b:
                    # Check vertical overlap
                    y_overlap = max(b["y0"], ty0) < min(b["y1"], ty1)
                    if y_overlap:
                        # Check if it is to the left of the username text
                        dist = tx0 - b["x1"]
                        if 0 <= dist < 200:
                            if dist < min_dist:
                                min_dist = dist
                                best_avatar = b
                                
    return best_avatar

def find_avatar_by_username(d, target_username: str):
    """
    Locates the target username TextView and its corresponding avatar ImageView bounds.
    """
    xml_data = d.dump_hierarchy()
    root = ET.fromstring(xml_data)
    
    target_text_node = None
    for node in root.iter('node'):
        text = node.attrib.get("text", "").strip()
        if text and is_fuzzy_match(text, target_username):
            target_text_node = node
            break
            
    if target_text_node is None:
        return None
        
    actual_text = target_text_node.attrib.get("text")
    t_bounds = parse_bounds(target_text_node.attrib.get("bounds", ""))
    if not t_bounds:
        return None
        
    log_action("MATCH_AVATAR", f"Found target username text '{actual_text}' at bounds {target_text_node.attrib.get('bounds')}")
    
    # Locate the adjacent avatar ImageView
    avatar_bounds = find_avatar_node_for_username(root, target_text_node)
    if avatar_bounds:
        log_action("MATCH_AVATAR", f"Found adjacent avatar ImageView at bounds [{avatar_bounds['x0']},{avatar_bounds['y0']}][{avatar_bounds['x1']},{avatar_bounds['y1']}]")
        return avatar_bounds
        
    log_action("MATCH_AVATAR", "No adjacent avatar ImageView found. Falling back to username text bounds.")
    return t_bounds

def scroll_safe(d, direction: str = "up"):
    """
    Performs a safe scroll by swiping near the left edge of the screen
    with a short duration to prevent triggering long-press events on cards.
    """
    width, height = d.window_size()
    # Use left safety zone (15% of screen width) to avoid card elements
    x = int(width * 0.15)
    
    if direction == "up":
        # Swipe up to scroll down
        y_start = int(height * 0.7)
        y_end = int(height * 0.3)
    else:
        # Swipe down to scroll up
        y_start = int(height * 0.3)
        y_end = int(height * 0.7)
        
    duration_ms = 350
    log_action("SCROLL", f"Safe swipe: ({x}, {y_start}) -> ({x}, {y_end})")
    
    try:
        # Bypasses the jsonrpc server by running native input swipe, more stable & robust
        cmd = f"input swipe {x} {y_start} {x} {y_end} {duration_ms}"
        d.shell(cmd, timeout=3.0)
    except Exception as e:
        log_action("SCROLL_WARNING", f"Shell swipe failed, falling back to uiautomator2 swipe: {e}")
        d.swipe(x, y_start, x, y_end, duration=duration_ms/1000.0)

def click_avatar_by_username(d, target_username: str, max_scrolls: int = 8) -> bool:
    """
    Searches for the target username on the screen, scrolling down if necessary.
    Clicks the avatar/text when found.
    """
    for scroll in range(max_scrolls + 1):
        log_action("SEARCH_USER", f"Searching for '{target_username}' (Scroll attempt {scroll}/{max_scrolls})...")
        target_bounds = find_avatar_by_username(d, target_username)
        if target_bounds:
            log_action("CLICK", f"Executing click at ({target_bounds['cx']}, {target_bounds['cy']}) for '{target_username}'.")
            d.click(target_bounds["cx"], target_bounds["cy"])
            return True
            
        if scroll < max_scrolls:
            log_action("SCROLL", "Target not found on current view. Scrolling down to fetch more items...")
            scroll_safe(d, "up")
            time.sleep(2.0)
            
    log_action("NOT_FOUND", f"Target user '{target_username}' not found after {max_scrolls} scrolls.")
    return False

def is_on_user_homepage(d):
    log_action("DUMP_UI", "Checking current page hierarchy for target profile verification.")
    xml_data = d.dump_hierarchy()
    root = ET.fromstring(xml_data)
    
    indicators = ["粉丝", "关注", "动态", "宝贝", "评价"]
    found_indicators = []
    has_owner_title = False
    
    for node in root.iter('node'):
        text = node.attrib.get("text", "").strip()
        desc = node.attrib.get("content-desc", "").strip()
        combined = text + desc
        
        if "的闲鱼" in combined:
            has_owner_title = True
        for ind in indicators:
            if ind in combined and ind not in found_indicators:
                found_indicators.append(ind)
            
    if has_owner_title or len(found_indicators) >= 2:
        log_action("VERIFY_HOMEPAGE", f"Homepage matched. Owner title detected: {has_owner_title}. Indicators: {found_indicators}")
        return True
    log_action("VERIFY_HOMEPAGE", f"Homepage match failed. Indicators: {found_indicators}")
    return False

def check_transaction_history(d):
    log_action("CHECK_HISTORY", "Checking for transaction history on the evaluation tab.")
    time.sleep(2.0) # wait for tab content to load
    
    xml_data = d.dump_hierarchy()
    root = ET.fromstring(xml_data)
    
    has_transaction = False
    for node in root.iter('node'):
        text = node.attrib.get("text", "").strip()
        desc = node.attrib.get("content-desc", "").strip()
        combined = text + desc
        
        if "来自买家" in combined or "来自卖家" in combined or "好评" in combined or "已折叠了" in combined:
            has_transaction = True
            break
            
    if has_transaction:
        log_action("HISTORY_RESULT", "Found transaction history (evaluations exist).")
    else:
        log_action("HISTORY_RESULT", "No transaction history found (0 evaluations).")
    
    return has_transaction

def main():
    parser = argparse.ArgumentParser(description="Find and click a specific user's avatar to navigate to their home page.")
    parser.add_argument("--username", type=str, help="The username to search and click.")
    args = parser.parse_args()
    
    log_action("INIT", "Connecting to the Android device via UIAutomator2.")
    d = u2.connect()
    log_action("INIT", "Device connection established successfully.")
    
    # Check screen state and try to recover if not on Home/Feed
    log_action("CHECK_STATE", "Checking if we are on the Home screen.")
    xml_data = d.dump_hierarchy()
    if "首页" not in xml_data:
        log_action("RECOVER", "Home screen indicators missing. Dispatching BACK button event.")
        d.press("back")
        log_action("RECOVER", "Waiting 2.0s for navigation to complete.")
        time.sleep(2.0)
    else:
        log_action("CHECK_STATE", "Home screen indicator verified.")

    # Get target username
    target_username = args.username
    if not target_username:
        # Prompt user if not passed from CLI
        print("\n[?] Enter target username to search: ", end="")
        sys.stdout.flush()
        target_username = sys.stdin.readline().strip()
        
    if not target_username:
        log_action("ERROR", "No username provided. Aborting.")
        return

    # Execute search and click flow
    success = click_avatar_by_username(d, target_username)
    if success:
        log_action("WAIT", "Waiting for page transition to user homepage...")
        # Wait up to 8 seconds for the '评价' (Evaluation/Reviews) tab to appear. In Xianyu it's in content-desc.
        tab_node = d(descriptionContains="评价")
        tab_found = tab_node.wait(timeout=8.0)
        
        if tab_found:
            log_action("SUCCESS", f"Opened homepage of '{target_username}'.")
            log_action("CLICK_TAB", "Found '评价' tab, executing click.")
            tab_node.click()
            
            # Check for transaction history
            check_transaction_history(d)
        else:
            # Fallback verification in case the user has no '评价' tab
            if is_on_user_homepage(d):
                log_action("SUCCESS", f"Opened homepage of '{target_username}', but no '评价' tab was found.")
            else:
                log_action("FAILURE", "Test failed: Target page is not recognized as the user's homepage. Visible texts:")
                new_xml = d.dump_hierarchy()
                new_root = ET.fromstring(new_xml)
                for node in new_root.iter('node'):
                    text = node.attrib.get("text", "").strip()
                    desc = node.attrib.get("content-desc", "").strip()
                    if text or desc:
                        print(f"  - TEXT: '{text}' DESC: '{desc}'")
    else:
        log_action("FAILURE", f"Could not find or click user '{target_username}'.")

if __name__ == "__main__":
    main()
