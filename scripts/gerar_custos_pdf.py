# -*- coding: utf-8 -*-
"""Gerar custos.pdf a partir de public/custos.html (Chrome headless)

Desde 11/08/2026, o `public/custos.pdf` em produção é o template oficial da
Proposta de Prestação de Serviços Jurídicos entregue pelo cliente, copiado
tal e qual — não gerado por este script. Correr isto por cima dele substitui
o documento oficial pelo HTML de apoio, que é só a versão legível/regenerável
do mesmo conteúdo. Não correr sem confirmar com o cliente.
"""
import subprocess, os
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
base = r"C:\Users\diogo\Desktop\law-project-repo"
html = os.path.join(base, "public", "custos.html")
out = os.path.join(base, "public", "custos.pdf")
r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={out}", f"file:///{html}"],
                   capture_output=True, text=True, timeout=90)
print("exit:", r.returncode, "| pdf existe:", os.path.exists(out), "| tamanho:", os.path.getsize(out) if os.path.exists(out) else 0)
