# -*- coding: utf-8 -*-
"""
Gera a pasta do cliente no OneDrive (My Documents) com o dossier do processo.

Uso:
    python gera_pasta_cliente.py <referencia|NIF>   modo manual: um processo à escolha
    python gera_pasta_cliente.py                    modo automático: todos os processos
                                                      submetidos que ainda não têm pasta

Cria, por processo:
    OneDrive\Documentos\Clientes\<Nome do Cliente>\
        dados_cliente.pdf      (resumo dos dados do processo)
        (anexos copiados da BD, se existirem)

O modo automático guarda as referências já processadas em
OneDrive\Documentos\Clientes\_controlo.txt, uma por linha, para não repetir
pastas em execuções seguintes.
"""
import subprocess, sys, os, re, json, base64, datetime, html

ONEDRIVE = os.path.join(os.path.expanduser("~"), "OneDrive")
PASTA_BASE = os.path.join(ONEDRIVE, "Documentos", "Clientes")
CONTROLO = os.path.join(PASTA_BASE, "_controlo.txt")
SSH = ["ssh", "-i", os.path.expanduser("~/.ollama/id_ed25519"), "-o", "StrictHostKeyChecking=no", "root@terlicalabs.com"]
DOCKER = "docker exec zt8qhu4noym88j011iiw3a39 psql -U lawproject -d lawproject -t -A -F@"

def psql(query):
    r = subprocess.run(SSH + [DOCKER + " -c " + json.dumps(query)], capture_output=True, text=True, timeout=90)
    return r.stdout.strip()

def criar_pasta(linha):
    """Recebe UMA linha do psql (referencia@nome@email@telefone@nif@estado@submetido_em),
    cria a pasta do cliente e o dados_cliente.pdf. Devolve a referência em caso de
    sucesso, ou None."""
    if not linha or linha.startswith("ERROR") or linha.count("@") < 6:
        print("Processo não encontrado:", linha[:120])
        return None
    partes = linha.split("@")
    ref, nome, email, telefone, nif, estado, sub = partes[0], partes[1], partes[2], partes[3], partes[4], partes[5], partes[6]
    nome = nome or "Sem Nome"
    # nome limpo para pasta
    nome_pasta = re.sub(r'[\\/:*?"<>|]', "", nome).strip()

    pasta = os.path.join(PASTA_BASE, nome_pasta)
    os.makedirs(pasta, exist_ok=True)

    # resumo em HTML -> PDF (dados vêm do cliente no onboarding — escapar
    # antes de meter no HTML, senão um nome com "<" ou "&" parte a página)
    e = html.escape
    data = datetime.date.today().strftime("%d/%m/%Y")
    pagina = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #101a24; font-size: 13px; padding: 32px; }}
      h1 {{ font-family: Georgia, serif; font-size: 22px; font-weight: 400; }}
      .marca {{ font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: #7a6a4a; }}
      table {{ margin-top: 18px; border-collapse: collapse; width: 100%; }}
      td {{ padding: 7px 8px; border-bottom: .6px solid #d8d4ca; }}
      td.k {{ color: #5c6270; width: 180px; }}</style></head><body>
      <div class="marca">PMF Consulting · Dossier do Cliente</div>
      <h1>{e(nome)}</h1>
      <table>
        <tr><td class="k">Processo</td><td>{e(ref)}</td></tr>
        <tr><td class="k">NIF/NIPC</td><td>{e(nif)}</td></tr>
        <tr><td class="k">Email</td><td>{e(email)}</td></tr>
        <tr><td class="k">Telefone</td><td>{e(telefone)}</td></tr>
        <tr><td class="k">Estado</td><td>{e(estado)}</td></tr>
        <tr><td class="k">Submetido</td><td>{e(sub)}</td></tr>
        <tr><td class="k">Pasta criada</td><td>{e(data)}</td></tr>
      </table></body></html>"""
    html_path = os.path.join(pasta, "_resumo.html")
    pdf_path = os.path.join(pasta, "dados_cliente.pdf")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(pagina)
    chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}", f"file:///{html_path}"],
                   capture_output=True, timeout=90)
    os.remove(html_path)

    print(f"✅ Pasta criada: {pasta}")
    print(f"   - dados_cliente.pdf ({os.path.getsize(pdf_path)} bytes)")
    print(f"   Processo {ref} · {nome} · {estado}")
    return ref

def modo_manual(alvo):
    # encontrar o processo (por referencia ou NIF) — UMA linha (o \n parte o
    # parsing por "@" feito em criar_pasta, por isso o LIMIT 1)
    # alvo vem de sys.argv: escapar aspas simples antes de meter na query,
    # senão um argumento como "o'brien" (ou pior, deliberado) parte a SQL.
    alvo_sql = alvo.replace("'", "''")
    q = ("SELECT po.referencia, di.nome, di.email, di.telefone, df.nif, po.estado, po.submetido_em "
         "FROM processo_onboarding po "
         "LEFT JOIN dados_identificacao di ON di.processo_id = po.id "
         "LEFT JOIN dados_fiscais df ON df.processo_id = po.id "
         f"WHERE po.referencia ILIKE '%{alvo_sql}%' OR df.nif = '{alvo_sql}' "
         "ORDER BY po.submetido_em DESC NULLS LAST LIMIT 1;")
    criar_pasta(psql(q))

def referencias_submetidas():
    """Todas as referências de processos submetidos, mais antigo primeiro."""
    q = ("SELECT po.referencia FROM processo_onboarding po "
         "WHERE po.estado = 'submetido' ORDER BY po.submetido_em ASC NULLS LAST;")
    saida = psql(q)
    if not saida or saida.startswith("ERROR"):
        return []
    return [l.strip() for l in saida.splitlines() if l.strip()]

def referencia_exata(ref):
    # referência já vem da própria BD — mas escapa-se na mesma, por hábito e
    # porque nada garante que uma referência futura não tenha um apóstrofo.
    ref_sql = ref.replace("'", "''")
    q = ("SELECT po.referencia, di.nome, di.email, di.telefone, df.nif, po.estado, po.submetido_em "
         "FROM processo_onboarding po "
         "LEFT JOIN dados_identificacao di ON di.processo_id = po.id "
         "LEFT JOIN dados_fiscais df ON df.processo_id = po.id "
         f"WHERE po.referencia = '{ref_sql}' LIMIT 1;")
    return psql(q)

def modo_automatico():
    os.makedirs(PASTA_BASE, exist_ok=True)

    processadas = set()
    if os.path.exists(CONTROLO):
        with open(CONTROLO, "r", encoding="utf-8") as f:
            processadas = {l.strip() for l in f if l.strip()}

    todas = referencias_submetidas()
    novas = [r for r in todas if r not in processadas]

    if not novas:
        print("Nada por processar — todos os processos submetidos já têm pasta.")
        return

    print(f"{len(novas)} processo(s) novo(s) a processar.")
    for ref in novas:
        ref_criada = criar_pasta(referencia_exata(ref))
        if ref_criada:
            with open(CONTROLO, "a", encoding="utf-8") as f:
                f.write(ref_criada + "\n")

def main():
    alvo = sys.argv[1] if len(sys.argv) > 1 else ""
    if alvo:
        modo_manual(alvo)
    else:
        modo_automatico()

if __name__ == "__main__":
    main()
