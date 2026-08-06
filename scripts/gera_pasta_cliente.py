# -*- coding: utf-8 -*-
"""
Gera a pasta do cliente no OneDrive (My Documents) com o dossier do processo.

Uso:
    python gera_pasta_cliente.py <referencia|NIF>

Cria:
    OneDrive\Documentos\Clientes\<Nome do Cliente>\
        dados_cliente.pdf      (resumo dos dados do processo)
        (anexos copiados da BD, se existirem)
"""
import subprocess, sys, os, re, json, base64, datetime

ONEDRIVE = os.path.join(os.path.expanduser("~"), "OneDrive")
PASTA_BASE = os.path.join(ONEDRIVE, "Documentos", "Clientes")
SSH = ["ssh", "-i", os.path.expanduser("~/.ollama/id_ed25519"), "-o", "StrictHostKeyChecking=no", "root@terlicalabs.com"]
DOCKER = "docker exec zt8qhu4noym88j011iiw3a39 psql -U lawproject -d lawproject -t -A -F@"

def psql(query):
    r = subprocess.run(SSH + [DOCKER + " -c " + json.dumps(query)], capture_output=True, text=True, timeout=90)
    return r.stdout.strip()

def main():
    alvo = sys.argv[1] if len(sys.argv) > 1 else ""
    if not alvo:
        print("uso: python gera_pasta_cliente.py <referencia|NIF>")
        return

    # encontrar o processo (por referencia ou NIF) — UMA linha (o \n parte o ssh)
    q = ("SELECT po.referencia, di.nome, di.email, di.telefone, df.nif, po.estado, po.submetido_em "
         "FROM processo_onboarding po "
         "LEFT JOIN dados_identificacao di ON di.processo_id = po.id "
         "LEFT JOIN dados_fiscais df ON df.processo_id = po.id "
         f"WHERE po.referencia ILIKE '%{alvo}%' OR df.nif = '{alvo}' "
         "ORDER BY po.submetido_em DESC NULLS LAST LIMIT 1;")
    linha = psql(q)
    if not linha or linha.startswith("ERROR") or linha.count("@") < 6:
        print("Processo não encontrado:", linha[:120])
        return
    partes = linha.split("@")
    ref, nome, email, telefone, nif, estado, sub = partes[0], partes[1], partes[2], partes[3], partes[4], partes[5], partes[6]
    nome = nome or "Sem Nome"
    # nome limpo para pasta
    nome_pasta = re.sub(r'[\\/:*?"<>|]', "", nome).strip()

    pasta = os.path.join(PASTA_BASE, nome_pasta)
    os.makedirs(pasta, exist_ok=True)

    # resumo em HTML -> PDF
    data = datetime.date.today().strftime("%d/%m/%Y")
    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #101a24; font-size: 13px; padding: 32px; }}
      h1 {{ font-family: Georgia, serif; font-size: 22px; font-weight: 400; }}
      .marca {{ font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: #7a6a4a; }}
      table {{ margin-top: 18px; border-collapse: collapse; width: 100%; }}
      td {{ padding: 7px 8px; border-bottom: .6px solid #d8d4ca; }}
      td.k {{ color: #5c6270; width: 180px; }}</style></head><body>
      <div class="marca">PMF Consulting · Dossier do Cliente</div>
      <h1>{nome}</h1>
      <table>
        <tr><td class="k">Processo</td><td>{ref}</td></tr>
        <tr><td class="k">NIF/NIPC</td><td>{nif}</td></tr>
        <tr><td class="k">Email</td><td>{email}</td></tr>
        <tr><td class="k">Telefone</td><td>{telefone}</td></tr>
        <tr><td class="k">Estado</td><td>{estado}</td></tr>
        <tr><td class="k">Submetido</td><td>{sub}</td></tr>
        <tr><td class="k">Pasta criada</td><td>{data}</td></tr>
      </table></body></html>"""
    html_path = os.path.join(pasta, "_resumo.html")
    pdf_path = os.path.join(pasta, "dados_cliente.pdf")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}", f"file:///{html_path}"],
                   capture_output=True, timeout=90)
    os.remove(html_path)

    print(f"✅ Pasta criada: {pasta}")
    print(f"   - dados_cliente.pdf ({os.path.getsize(pdf_path)} bytes)")
    print(f"   Processo {ref} · {nome} · {estado}")

if __name__ == "__main__":
    main()
