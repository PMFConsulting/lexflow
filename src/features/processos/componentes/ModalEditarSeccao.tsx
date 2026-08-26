"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { atualizarSeccaoProcesso } from "../acoes";
import type { Seccoes } from "@/features/onboarding/dados";
import type { TipoCliente } from "@/features/onboarding/passos";

type Props = {
  processoId: string;
  passo: number;
  tipoCliente: TipoCliente;
  seccoes: Seccoes;
  titulo: string;
};

export function ModalEditarSeccao({
  processoId,
  passo,
  tipoCliente,
  seccoes,
  titulo,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const router = useRouter();
  const [aGravar, transicao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  // Step 1
  const [nome, setNome] = useState(seccoes.identificacao?.nome ?? "");
  const [profissao, setProfissao] = useState(seccoes.identificacao?.profissao ?? "");
  const [entidadePatronal, setEntidadePatronal] = useState(seccoes.identificacao?.entidadePatronal ?? "");
  const [dataNascimento, setDataNascimento] = useState(seccoes.identificacao?.dataNascimento ?? "");
  const [naturezaJuridica, setNaturezaJuridica] = useState(seccoes.identificacao?.naturezaJuridica ?? "");
  const [dataConstituicao, setDataConstituicao] = useState(seccoes.identificacao?.dataConstituicao ?? "");
  const [telefone, setTelefone] = useState(seccoes.identificacao?.telefone ?? "");
  const [email, setEmail] = useState(seccoes.identificacao?.email ?? "");
  const [morada, setMorada] = useState(seccoes.identificacao?.morada ?? "");
  const [codigoPostal, setCodigoPostal] = useState(seccoes.identificacao?.codigoPostal ?? "");
  const [localidade, setLocalidade] = useState(seccoes.identificacao?.localidade ?? "");
  const [freguesia, setFreguesia] = useState(seccoes.identificacao?.freguesia ?? "");
  const [concelho, setConcelho] = useState(seccoes.identificacao?.concelho ?? "");
  const [distrito, setDistrito] = useState(seccoes.identificacao?.distrito ?? "");
  const [pais, setPais] = useState(seccoes.identificacao?.pais ?? "Portugal");
  const [nacionalidades, setNacionalidades] = useState(seccoes.nacionalidades.join(", "));

  // Step 2
  const [nif, setNif] = useState(seccoes.fiscais?.nif ?? "");
  const [nifPortugues, setNifPortugues] = useState(seccoes.fiscais?.nifPortugues ?? true);
  const [resideEmPortugal, setResideEmPortugal] = useState(seccoes.fiscais?.resideEmPortugal ?? true);
  const [docTipo, setDocTipo] = useState<"cartao_cidadao" | "passaporte" | "titulo_residencia" | "outro">(
    seccoes.fiscais?.docTipo ?? "cartao_cidadao",
  );
  const [docNumero, setDocNumero] = useState(seccoes.fiscais?.docNumero ?? "");
  const [docValidade, setDocValidade] = useState(seccoes.fiscais?.docValidade ?? "");
  const [cae, setCae] = useState(seccoes.fiscais?.cae ?? "");
  const [codigoCertidao, setCodigoCertidao] = useState(seccoes.fiscais?.codigoCertidaoPermanente ?? "");
  const [regimeIva, setRegimeIva] = useState<"normal" | "isento_art53" | "isento_art9" | "misto" | "">(
    seccoes.fiscais?.regimeIva ?? "",
  );

  // Step 3
  const [eRepresentante, setERepresentante] = useState(seccoes.representante?.eRepresentante ?? false);
  const [repRelacao, setRepRelacao] = useState(seccoes.representante?.relacao ?? "");
  const [repNome, setRepNome] = useState(seccoes.representante?.nome ?? "");
  const [repDataNascimento, setRepDataNascimento] = useState(seccoes.representante?.dataNascimento ?? "");
  const [repProfissao, setRepProfissao] = useState(seccoes.representante?.profissao ?? "");
  const [repTelefone, setRepTelefone] = useState(seccoes.representante?.telefone ?? "");
  const [repEmail, setRepEmail] = useState(seccoes.representante?.email ?? "");
  const [repMorada, setRepMorada] = useState(seccoes.representante?.morada ?? "");
  const [repPais, setRepPais] = useState(seccoes.representante?.pais ?? "Portugal");
  const [repLocalidade, setRepLocalidade] = useState(seccoes.representante?.localidade ?? "");
  const [repCodigoPostal, setRepCodigoPostal] = useState(seccoes.representante?.codigoPostal ?? "");
  const [repFreguesia, setRepFreguesia] = useState(seccoes.representante?.freguesia ?? "");
  const [repConcelho, setRepConcelho] = useState(seccoes.representante?.concelho ?? "");
  const [repDistrito, setRepDistrito] = useState(seccoes.representante?.distrito ?? "");
  const [repNif, setRepNif] = useState(seccoes.representante?.nif ?? "");
  const [repDocTipo, setRepDocTipo] = useState<"cartao_cidadao" | "passaporte" | "titulo_residencia" | "outro">(
    seccoes.representante?.docTipo ?? "cartao_cidadao",
  );
  const [repDocNumero, setRepDocNumero] = useState(seccoes.representante?.docNumero ?? "");
  const [repDocValidade, setRepDocValidade] = useState(seccoes.representante?.docValidade ?? "");
  const [repNacionalidades, setRepNacionalidades] = useState(seccoes.nacionalidadesRepresentante.join(", "));

  // Step 4
  const [ePpe, setEPpe] = useState(seccoes.ppe?.ePpe ?? false);
  const [ppeCargo, setPpeCargo] = useState(seccoes.ppe?.ppeCargo ?? "");
  const [ppePais, setPpePais] = useState(seccoes.ppe?.ppePais ?? "");
  const [ppeEntidade, setPpeEntidade] = useState(seccoes.ppe?.ppeEntidade ?? "");
  const [ppeInicio, setPpeInicio] = useState(seccoes.ppe?.ppeInicio ?? "");
  const [ppeFim, setPpeFim] = useState(seccoes.ppe?.ppeFim ?? "");
  const [eRelacionadoPpe, setERelacionadoPpe] = useState(seccoes.ppe?.eRelacionadoPpe ?? false);
  const [relacaoPpe, setRelacaoPpe] = useState(seccoes.ppe?.relacaoPpe ?? "");
  const [ppeRelacionadaNome, setPpeRelacionadaNome] = useState(seccoes.ppe?.ppeRelacionadaNome ?? "");
  const [ppeRelacionadaCargo, setPpeRelacionadaCargo] = useState(seccoes.ppe?.ppeRelacionadaCargo ?? "");
  const [ppeRelacionadaPais, setPpeRelacionadaPais] = useState(seccoes.ppe?.ppeRelacionadaPais ?? "");
  const [servicos, setServicos] = useState(seccoes.negocio?.servicos ?? "");
  const [origemFundos, setOrigemFundos] = useState(seccoes.negocio?.origemFundos ?? "");

  // Step 5
  const [fatIgual, setFatIgual] = useState(seccoes.faturacao?.igualAoCliente ?? false);
  const [fatNome, setFatNome] = useState(seccoes.faturacao?.nome ?? "");
  const [fatNif, setFatNif] = useState(seccoes.faturacao?.nif ?? "");
  const [fatEmail, setFatEmail] = useState(seccoes.faturacao?.email ?? "");
  const [fatAcIgual, setFatAcIgual] = useState(seccoes.faturacao?.acIgualAoCliente ?? true);
  const [fatAcNome, setFatAcNome] = useState(seccoes.faturacao?.acNome ?? "");
  const [fatAcEmail, setFatAcEmail] = useState(seccoes.faturacao?.acEmail ?? "");
  const [fatAcTelefone, setFatAcTelefone] = useState(seccoes.faturacao?.acTelefone ?? "");
  const [fatMorada, setFatMorada] = useState(seccoes.faturacao?.morada ?? "");
  const [fatCodigoPostal, setFatCodigoPostal] = useState(seccoes.faturacao?.codigoPostal ?? "");
  const [fatLocalidade, setFatLocalidade] = useState(seccoes.faturacao?.localidade ?? "");
  const [fatFreguesia, setFatFreguesia] = useState(seccoes.faturacao?.freguesia ?? "");
  const [fatConcelho, setFatConcelho] = useState(seccoes.faturacao?.concelho ?? "");
  const [fatDistrito, setFatDistrito] = useState(seccoes.faturacao?.distrito ?? "");
  const [fatPais, setFatPais] = useState(seccoes.faturacao?.pais ?? "Portugal");

  // Step 6
  const [origemContacto, setOrigemContacto] = useState(seccoes.preferencias?.origemContacto ?? "");
  const [origemDetalhe, setOrigemDetalhe] = useState(seccoes.preferencias?.origemDetalhe ?? "");
  const [newsletter, setNewsletter] = useState(seccoes.preferencias?.newsletter ?? false);
  const [emailsNewsletter, setEmailsNewsletter] = useState(seccoes.emailsNewsletter.join(", "));
  const [areasInteresse, setAreasInteresse] = useState(seccoes.areasInteresse.join(", "));
  const [convitesIniciativas, setConvitesIniciativas] = useState(seccoes.preferencias?.convitesIniciativas ?? false);
  const [convitesNome, setConvitesNome] = useState(seccoes.preferencias?.convitesNome ?? "");
  const [convitesEmail, setConvitesEmail] = useState(seccoes.preferencias?.convitesEmail ?? "");

  // Step 7
  const [tcAceitacao, setTcAceitacao] = useState(seccoes.fecho?.tcAceitacao ?? true);
  const [declaracaoVeracidade, setDeclaracaoVeracidade] = useState(seccoes.fecho?.declaracaoVeracidade ?? true);
  const [propostaAceitacao, setPropostaAceitacao] = useState(seccoes.fecho?.propostaAceitacao ?? true);

  const guardar = () => {
    setErro(null);

    let dados: Record<string, unknown> = {};

    if (passo === 1) {
      dados = {
        nome,
        profissao: tipoCliente === "particular" ? profissao : null,
        entidadePatronal: tipoCliente === "particular" ? entidadePatronal : null,
        dataNascimento: tipoCliente === "particular" ? dataNascimento : null,
        naturezaJuridica: tipoCliente === "empresa" ? naturezaJuridica : null,
        dataConstituicao: tipoCliente === "empresa" ? dataConstituicao : null,
        telefone,
        email,
        morada,
        codigoPostal,
        localidade,
        freguesia,
        concelho,
        distrito,
        pais,
        nacionalidades: nacionalidades.split(",").map((s: string) => s.trim()).filter(Boolean),
      };
    } else if (passo === 2) {
      dados = {
        nif,
        nifPortugues,
        resideEmPortugal,
        docTipo,
        docNumero,
        docValidade,
        cae: tipoCliente === "empresa" ? cae : null,
        codigoCertidaoPermanente: tipoCliente === "empresa" ? codigoCertidao : null,
        regimeIva: regimeIva || null,
      };
    } else if (passo === 3) {
      dados = {
        eRepresentante,
        relacao: repRelacao,
        nome: repNome,
        dataNascimento: repDataNascimento,
        profissao: repProfissao,
        telefone: repTelefone,
        email: repEmail,
        morada: repMorada,
        pais: repPais,
        localidade: repLocalidade,
        codigoPostal: repCodigoPostal,
        freguesia: repFreguesia,
        concelho: repConcelho,
        distrito: repDistrito,
        nif: repNif,
        docTipo: repDocTipo,
        docNumero: repDocNumero,
        docValidade: repDocValidade,
        nacionalidades: repNacionalidades.split(",").map((s: string) => s.trim()).filter(Boolean),
      };
    } else if (passo === 4) {
      dados = {
        ePpe,
        ppeCargo,
        ppePais,
        ppeEntidade,
        ppeInicio,
        ppeFim,
        eRelacionadoPpe,
        relacaoPpe,
        ppeRelacionadaNome,
        ppeRelacionadaCargo,
        ppeRelacionadaPais,
        servicos,
        origemFundos,
      };
    } else if (passo === 5) {
      dados = {
        igualAoCliente: fatIgual,
        nome: fatNome,
        nif: fatNif,
        email: fatEmail,
        acIgualAoCliente: fatAcIgual,
        acNome: fatAcNome,
        acEmail: fatAcEmail,
        acTelefone: fatAcTelefone,
        morada: fatMorada,
        codigoPostal: fatCodigoPostal,
        localidade: fatLocalidade,
        freguesia: fatFreguesia,
        concelho: fatConcelho,
        distrito: fatDistrito,
        pais: fatPais,
      };
    } else if (passo === 6) {
      dados = {
        origemContacto: origemContacto || null,
        origemDetalhe,
        newsletter,
        emailsNewsletter: emailsNewsletter.split(",").map((s: string) => s.trim()).filter(Boolean),
        areasInteresse: areasInteresse.split(",").map((s: string) => s.trim()).filter(Boolean),
        convitesIniciativas,
        convitesNome,
        convitesEmail,
      };
    } else if (passo === 7) {
      dados = {
        tcAceitacao,
        declaracaoVeracidade,
        propostaAceitacao,
      };
    }

    transicao(async () => {
      try {
        const r = await atualizarSeccaoProcesso(processoId, passo, dados);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        setAberto(false);
        router.refresh();
      } catch {
        setErro("Não foi possível gravar as alterações.");
      }
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs font-normal">
          <Pencil className="size-3" />
          Editar
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="py-4">
          <DialogTitle className="text-base">Editar {titulo}</DialogTitle>
          <DialogDescription className="text-xs">
            Altere ou preencha os dados desta secção. As modificações são registadas na auditoria.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          {erro && (
            <div className="flex items-center gap-2 rounded-md bg-selo/10 p-3 text-xs text-selo border border-selo/20">
              <TriangleAlert className="size-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {passo === 1 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Nome / Denominação</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Telefone</Label>
                <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} />
              </div>
              {tipoCliente === "particular" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Profissão</Label>
                    <Input value={profissao} onChange={(e) => setProfissao(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Entidade patronal</Label>
                    <Input value={entidadePatronal} onChange={(e) => setEntidadePatronal(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Data de nascimento</Label>
                    <Input type="date" value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} />
                  </div>
                </>
              )}
              {tipoCliente === "empresa" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Natureza jurídica</Label>
                    <Input value={naturezaJuridica} onChange={(e) => setNaturezaJuridica(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Data de constituição</Label>
                    <Input type="date" value={dataConstituicao} onChange={(e) => setDataConstituicao(e.target.value)} />
                  </div>
                </>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Nacionalidade(s) (separadas por vírgula)</Label>
                <Input value={nacionalidades} onChange={(e) => setNacionalidades(e.target.value)} placeholder="Portugal, Espanha" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Morada</Label>
                <Input value={morada} onChange={(e) => setMorada(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Código Postal</Label>
                <Input value={codigoPostal} onChange={(e) => setCodigoPostal(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Localidade</Label>
                <Input value={localidade} onChange={(e) => setLocalidade(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Freguesia</Label>
                <Input value={freguesia} onChange={(e) => setFreguesia(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Concelho</Label>
                <Input value={concelho} onChange={(e) => setConcelho(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Distrito</Label>
                <Input value={distrito} onChange={(e) => setDistrito(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">País</Label>
                <Input value={pais} onChange={(e) => setPais(e.target.value)} />
              </div>
            </div>
          )}

          {passo === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">NIF / NIPC</Label>
                <Input value={nif} onChange={(e) => setNif(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="nifPortugues"
                  checked={nifPortugues}
                  onChange={(e) => setNifPortugues(e.target.checked)}
                  className="rounded border-linha"
                />
                <Label htmlFor="nifPortugues" className="text-xs font-normal">NIF português</Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="resideEmPortugal"
                  checked={resideEmPortugal}
                  onChange={(e) => setResideEmPortugal(e.target.checked)}
                  className="rounded border-linha"
                />
                <Label htmlFor="resideEmPortugal" className="text-xs font-normal">Reside / Sede em Portugal</Label>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Tipo de documento</Label>
                <select
                  value={docTipo}
                  onChange={(e) => setDocTipo(e.target.value as typeof docTipo)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
                >
                  <option value="cartao_cidadao">Cartão de Cidadão</option>
                  <option value="passaporte">Passaporte</option>
                  <option value="titulo_residencia">Título de Residência</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Número do documento</Label>
                <Input value={docNumero} onChange={(e) => setDocNumero(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Validade do documento</Label>
                <Input type="date" value={docValidade} onChange={(e) => setDocValidade(e.target.value)} />
              </div>
              {tipoCliente === "empresa" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">CAE</Label>
                    <Input value={cae} onChange={(e) => setCae(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Regime de IVA</Label>
                    <select
                      value={regimeIva}
                      onChange={(e) => setRegimeIva(e.target.value as typeof regimeIva)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
                    >
                      <option value="">(Não especificado)</option>
                      <option value="normal">Normal</option>
                      <option value="isento_art53">Isento (Art. 53º)</option>
                      <option value="isento_art9">Isento (Art. 9º)</option>
                      <option value="misto">Misto</option>
                    </select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs font-medium">Código Certidão Permanente</Label>
                    <Input value={codigoCertidao} onChange={(e) => setCodigoCertidao(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}

          {passo === 3 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  id="eRepresentante"
                  checked={eRepresentante}
                  onChange={(e) => setERepresentante(e.target.checked)}
                  className="rounded border-linha"
                />
                <Label htmlFor="eRepresentante" className="text-xs font-medium">
                  Quem preencheu o processo é o representante legal
                </Label>
              </div>
              {!eRepresentante && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Cargo / Relação</Label>
                    <Input value={repRelacao} onChange={(e) => setRepRelacao(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Nome do representante</Label>
                    <Input value={repNome} onChange={(e) => setRepNome(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Email</Label>
                    <Input type="email" value={repEmail} onChange={(e) => setRepEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Telefone</Label>
                    <Input value={repTelefone} onChange={(e) => setRepTelefone(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Profissão</Label>
                    <Input value={repProfissao} onChange={(e) => setRepProfissao(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">NIF</Label>
                    <Input value={repNif} onChange={(e) => setRepNif(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Documento</Label>
                    <Input value={repDocNumero} onChange={(e) => setRepDocNumero(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Validade</Label>
                    <Input type="date" value={repDocValidade} onChange={(e) => setRepDocValidade(e.target.value)} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs font-medium">Morada</Label>
                    <Input value={repMorada} onChange={(e) => setRepMorada(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}

          {passo === 4 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  id="ePpe"
                  checked={ePpe}
                  onChange={(e) => setEPpe(e.target.checked)}
                  className="rounded border-linha"
                />
                <Label htmlFor="ePpe" className="text-xs font-medium">
                  É Pessoa Politicamente Exposta (PPE)
                </Label>
              </div>
              {ePpe && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Cargo PPE</Label>
                    <Input value={ppeCargo} onChange={(e) => setPpeCargo(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Entidade PPE</Label>
                    <Input value={ppeEntidade} onChange={(e) => setPpeEntidade(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">País PPE</Label>
                    <Input value={ppePais} onChange={(e) => setPpePais(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Início Exercício</Label>
                    <Input value={ppeInicio} onChange={(e) => setPpeInicio(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Fim Exercício (se aplicável)</Label>
                    <Input value={ppeFim} onChange={(e) => setPpeFim(e.target.value)} />
                  </div>
                </>
              )}
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  id="eRelacionadoPpe"
                  checked={eRelacionadoPpe}
                  onChange={(e) => setERelacionadoPpe(e.target.checked)}
                  className="rounded border-linha"
                />
                <Label htmlFor="eRelacionadoPpe" className="text-xs font-medium">
                  É familiar ou associado próximo de PPE
                </Label>
              </div>
              {eRelacionadoPpe && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Relação com PPE</Label>
                    <Input value={relacaoPpe} onChange={(e) => setRelacaoPpe(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Nome da PPE relacionada</Label>
                    <Input value={ppeRelacionadaNome} onChange={(e) => setPpeRelacionadaNome(e.target.value)} />
                  </div>
                </>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Serviços Contratados</Label>
                <Input value={servicos} onChange={(e) => setServicos(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Origem dos Fundos</Label>
                <Input value={origemFundos} onChange={(e) => setOrigemFundos(e.target.value)} />
              </div>
            </div>
          )}

          {passo === 5 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Nome ou Denominação para faturação</Label>
                <Input value={fatNome} onChange={(e) => setFatNome(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">NIF</Label>
                <Input value={fatNif} onChange={(e) => setFatNif(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Email de faturação</Label>
                <Input type="email" value={fatEmail} onChange={(e) => setFatEmail(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Ao cuidado de (Nome)</Label>
                <Input value={fatAcNome} onChange={(e) => setFatAcNome(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Morada</Label>
                <Input value={fatMorada} onChange={(e) => setFatMorada(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Código Postal</Label>
                <Input value={fatCodigoPostal} onChange={(e) => setFatCodigoPostal(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Localidade</Label>
                <Input value={fatLocalidade} onChange={(e) => setFatLocalidade(e.target.value)} />
              </div>
            </div>
          )}

          {passo === 6 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Como chegou até nós</Label>
                <select
                  value={origemContacto}
                  onChange={(e) => setOrigemContacto(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
                >
                  <option value="">(Não especificado)</option>
                  <option value="evento_conferencia">Evento / Conferência</option>
                  <option value="recomendacao">Recomendação</option>
                  <option value="pesquisa_online">Pesquisa Online</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Detalhe da origem</Label>
                <Input value={origemDetalhe} onChange={(e) => setOrigemDetalhe(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  id="newsletter"
                  checked={newsletter}
                  onChange={(e) => setNewsletter(e.target.checked)}
                  className="rounded border-linha"
                />
                <Label htmlFor="newsletter" className="text-xs font-medium">Subscrever newsletter</Label>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Emails para newsletter (separados por vírgula)</Label>
                <Input value={emailsNewsletter} onChange={(e) => setEmailsNewsletter(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs font-medium">Áreas de interesse (separadas por vírgula)</Label>
                <Input value={areasInteresse} onChange={(e) => setAreasInteresse(e.target.value)} />
              </div>
            </div>
          )}

          {passo === 7 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="tcAceitacao"
                  checked={tcAceitacao}
                  onChange={(e) => setTcAceitacao(e.target.checked)}
                  className="rounded border-linha"
                />
                <Label htmlFor="tcAceitacao" className="text-xs font-medium">
                  Termos e Condições e Proposta aceites
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="declaracaoVeracidade"
                  checked={declaracaoVeracidade}
                  onChange={(e) => setDeclaracaoVeracidade(e.target.checked)}
                  className="rounded border-linha"
                />
                <Label htmlFor="declaracaoVeracidade" className="text-xs font-medium">
                  Declaração de veracidade aceite
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="propostaAceitacao"
                  checked={propostaAceitacao}
                  onChange={(e) => setPropostaAceitacao(e.target.checked)}
                  className="rounded border-linha"
                />
                <Label htmlFor="propostaAceitacao" className="text-xs font-medium">
                  Proposta comercial aceite
                </Label>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="py-3 border-t">
          <Button variant="outline" size="sm" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button size="sm" disabled={aGravar} onClick={guardar}>
            {aGravar ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin mr-1.5" />
                A guardar…
              </>
            ) : (
              "Guardar alterações"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
