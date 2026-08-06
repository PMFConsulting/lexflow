# -*- coding: utf-8 -*-
"""Gerar custos.pdf a partir de public/custos.html (Chrome headless)"""
import subprocess, os
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
base = r"C:\Users\diogo\Desktop\law-project-repo"
html = os.path.join(base, "public", "custos.html")
out = os.path.join(base, "public", "custos.pdf")
r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={out}", f"file:///{html}"],
                   capture_output=True, text=True, timeout=90)
print("exit:", r.returncode, "| pdf existe:", os.path.exists(out), "| tamanho:", os.path.getsize(out) if os.path.exists(out) else 0)
