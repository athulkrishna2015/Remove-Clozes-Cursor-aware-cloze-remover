import time
from typing import List, Callable

_logs: List[str] = []
_listeners: List[Callable[[str], None]] = []

def log(message: str):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {message}"
    _logs.append(formatted)
    # Notify active UI listeners
    for listener in _listeners:
        try:
            listener(formatted)
        except Exception:
            pass

def get_logs() -> List[str]:
    return _logs

def clear_logs():
    _logs.clear()

def add_listener(callback: Callable[[str], None]):
    if callback not in _listeners:
        _listeners.append(callback)

def remove_listener(callback: Callable[[str], None]):
    if callback in _listeners:
        _listeners.remove(callback)
