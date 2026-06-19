# Manual de Hospedagem e Requisitos de TI — Painel UNESCO RS (Produto 4)

Este documento destina-se à equipe de **TI e DevOps da Secretaria da Educação do Rio Grande do Sul (SEDUC-RS)**. Ele detalha as diretrizes de segurança, os requisitos de hospedagem e os passos práticos para publicar o **Painel de Indicadores Educacionais** sob a infraestrutura e o domínio oficial do Estado.

---

## 1. Natureza do Painel (Arquitetura)

O painel foi construído utilizando uma arquitetura moderna conhecida como **JAMstack estático**:
- **Tecnologias**: HTML5, JavaScript Puro (ES6+) e CSS3 (Vanilla).
- **Bibliotecas**: Chart.js v4 (gráficos) e Leaflet v1.9 (mapa interativo).
- **Dados**: Arquivos estáticos JSON pré-compilados localizados na pasta `dados/`.

### O que isso significa para a TI da SEDUC-RS:
- **Sem Backend Dinâmico**: A hospedagem não necessita de servidores PHP, Python, Java, Node.js ou contêineres Docker.
- **Sem Banco de Dados**: A aplicação é executada inteiramente no navegador do usuário final (Client-Side Rendering). O banco de dados do INEP/Censo já foi sumarizado em JSONs leves pelo pipeline de ETL local.
- **Hospedagem Leve**: O painel pode ser hospedado em qualquer serviço de arquivos estáticos, incluindo **GitHub Pages** (gratuito e escalável), AWS S3, Cloudflare Pages, Netlify ou servidores web tradicionais Nginx/Apache.

---

## 2. Requisitos de Segurança e Segurança de Dados (Regra de Ouro)

> [!CAUTION]
> **REGRA DE OURO DE SEGURANÇA E PRIVACIDADE DE DADOS**
> A pasta raiz do projeto de desenvolvimento contém scripts de ETL em Python e, principalmente, planilhas originais do INEP e bases de dados do SAERS na pasta `00. Bases de Dados/`.
> 
> Esses arquivos de base de dados contêm **microdados educacionais brutos**. Eles **NUNCA devem ser publicados no repositório público do GitHub da SEDUC-RS**, sob o risco de vazamento de dados sensíveis e violação da LGPD (Lei Geral de Proteção de Dados).
> 
> **Somente o conteúdo localizado dentro da pasta `/painel` deve ser commitado e hospedado publicamente.**

---

## 3. Passo a Passo: Publicando o Painel no GitHub da SEDUC-RS

Para publicar o painel usando o **GitHub Pages**, siga os passos abaixo:

### Passo 1: Criar o Repositório no GitHub da SEDUC-RS
1. Acesse a organização ou conta do GitHub da SEDUC-RS.
2. Crie um novo repositório chamado, por exemplo, `indicadores-educacionais` (público ou privado).

### Passo 2: Inicializar o Git apenas com os arquivos de Produção
No seu terminal local, navegue **para dentro** da pasta `painel` (nunca na raiz do projeto UNESCO) e execute os seguintes comandos:

```bash
# 1. Navegar para a pasta do painel
cd "C:\Caminho\Para\Produto 4_Indicadores Educacionais\painel"

# 2. Inicializar o Git localmente nesta pasta
git init

# 3. Renomear a branch principal para main
git branch -M main

# 4. Adicionar o link do repositório da SEDUC como remote
git remote add origin https://github.com/SEDUC-ORGANIZACAO/indicadores-educacionais.git

# 5. Adicionar todos os arquivos da pasta painel (HTML, JS, CSS, JSONs compilados)
git add .

# 6. Criar o commit inicial
git commit -m "feat: deploy inicial do painel de indicadores"

# 7. Enviar para o repositório remoto
git push -u origin main
```

### Passo 3: Ativar o GitHub Pages no Repositório
1. No painel do repositório no GitHub, clique na aba **Settings** (Configurações).
2. Na barra lateral esquerda, na seção *Code and automation*, clique em **Pages**.
3. Em *Build and deployment* -> *Source*, escolha **Deploy from a branch**.
4. Em *Branch*, selecione **`main`** e a pasta como **`/ (root)`**.
5. Clique em **Save**.

Após alguns segundos, o GitHub gerará uma URL pública para o painel. O endereço terá a estrutura:
`https://SEDUC-ORGANIZACAO.github.io/indicadores-educacionais/`

---

## 4. Configurando um Domínio Oficial (Custom Domain)

Para que o painel responda sob um subdomínio governamental oficial (exemplo: `indicadores.educacao.rs.gov.br`):

### Passo A: Criar o Registro DNS na SEDUC-RS
A equipe de redes da SEDUC-RS deve criar um registro **CNAME** na tabela de DNS do domínio `educacao.rs.gov.br`:

| Nome/Host | Tipo | Valor/Destino |
| :--- | :--- | :--- |
| `indicadores` | **CNAME** | `SEDUC-ORGANIZACAO.github.io` |

### Passo B: Adicionar o Domínio no Repositório do GitHub
1. Nas configurações de **Pages** do seu repositório no GitHub.
2. No campo **Custom domain**, digite o endereço configurado: `indicadores.educacao.rs.gov.br`.
3. Clique em **Save**.
   - Isso criará automaticamente um arquivo chamado `CNAME` (sem extensão) na raiz do repositório contendo apenas o domínio.
4. Marque a opção **Enforce HTTPS** para garantir que a conexão seja criptografada por SSL (o GitHub gerará e renovará o certificado de forma automática e gratuita).

---

## 5. Integração com Portais Existentes (WordPress / Portal Oficial)

Caso a SEDUC prefira incorporar o painel dentro de um CMS existente (como o site oficial da secretaria, WordPress, Drupal, etc.) mantendo o cabeçalho e rodapé oficial do portal do governo, recomenda-se a inserção via **`<iframe>` responsivo**.

Utilize o código HTML e CSS abaixo para garantir que o painel se ajuste perfeitamente e evite barras de rolagem duplas desnecessárias:

```html
<!-- Container do iframe responsivo -->
<div class="painel-indicadores-container">
  <iframe 
    src="https://indicadores.educacao.rs.gov.br" 
    class="painel-iframe" 
    loading="lazy" 
    title="Painel de Indicadores Educacionais — SEDUC-RS"
    style="border: none; width: 100%; height: 100%;">
  </iframe>
</div>

<!-- Estilo CSS recomendado para o contêiner -->
<style>
.painel-indicadores-container {
  position: relative;
  width: 100%;
  height: 90vh; /* Ocupa 90% da altura da tela */
  overflow: hidden;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
@media (max-width: 768px) {
  .painel-indicadores-container {
    height: 100vh; /* No mobile, aumenta o espaço vertical */
  }
}
</style>
```
