# -*- coding: utf-8 -*-
"""Gerar custos.pdf a partir de public/custos.html (Chrome headless)

Desde 11/08/2026, o `public/custos.pdf` em produção é o template oficial da
Proposta de Prestação de Serviços Jurídicos entregue pelo cliente, copiado
tal e qual — não gerado por este script. Correr isto por cima dele substitui
o documento oficial pelo HTML de apoio, que é só a versão legível/regenerável
do mesmo conteúdo. Não correr sem confirmar com o cliente.
"""
import subprocess, os, shutil, sys

# Script de apoio ao desenvolvimento, não de produção: corre na máquina de quem
# edita o HTML. Nada aqui fica preso a uma instalação — a raiz do repositório
# deriva da localização deste ficheiro, e o Chrome procura-se no PATH (ou
# indica-se em CHROME=...), porque o caminho do executável muda com o sistema
# operativo e com a forma como o browser foi instalado.
def _procurar_chrome():
    indicado = os.environ.get("CHROME")
    if indicado:
        return indicado
    for nome in ("chrome", "google-chrome", "chromium", "msedge"):
        achado = shutil.which(nome)
        if achado:
            return achado
    # No Windows o Chrome não costuma estar no PATH; estes são os locais de
    # instalação por omissão, sem nome de utilizador pelo meio.
    for candidato in (
        os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ):
        if os.path.exists(candidato):
            return candidato
    return None


CHROME = _procurar_chrome()
if not CHROME:
    sys.exit("Chrome não encontrado. Indique o executável em CHROME=... ou ponha-o no PATH.")

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = os.path.join(base, "public", "custos.html")
out = os.path.join(base, "public", "custos.pdf")
r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={out}", f"file:///{html}"],
                   capture_output=True, text=True, timeout=90)
print("exit:", r.returncode, "| pdf existe:", os.path.exists(out), "| tamanho:", os.path.getsize(out) if os.path.exists(out) else 0)
