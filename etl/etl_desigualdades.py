import csv
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

BASE = Path(r'C:\Users\mathe\OneDrive\Desktop\Trabalhos\06. UNESCO\04. Produto 4_Indicadores Educacionais')
SAERS_DIR = BASE / '00. Bases de Dados' / '10, SAERS'
OUTPUT = BASE / 'painel' / 'dados' / '4_11_desigualdades.json'

ANOS = [2022, 2023, 2024, 2025]

# Mapeamento de raça para labels padronizados (handles 2023 UPPER, 2024 Title, 2025 com sufixo)
RACA_MAP = {
    # 2025 format: Branco(a)
    'Branco(a)': 'Branca',
    'Pardo(a)': 'Parda',
    'Preto(a)': 'Preta',
    'Amarelo(a)': 'Amarela',
    'Ind\xedgena(a)': 'Ind\u00edgena',
    # 2024 format: Title case
    'Branca': 'Branca',
    'Parda': 'Parda',
    'Preta': 'Preta',
    'Amarela': 'Amarela',
    'Ind\xedgena': 'Ind\u00edgena',
    'Indigena': 'Ind\u00edgena',
    # 2023 format: UPPERCASE
    'BRANCA': 'Branca',
    'PARDA': 'Parda',
    'PRETA': 'Preta',
    'AMARELA': 'Amarela',
    'INDIGENA': 'Ind\u00edgena',
}

SEXO_MAP = {
    'Feminino': 'Feminino',
    'Masculino': 'Masculino',
    'FEMININO': 'Feminino',
    'MASCULINO': 'Masculino',
}

ETAPA_MAP = {
    'ENSINO FUNDAMENTAL DE 9 ANOS - 2\xba ANO': '2_EF',
    'ENSINO FUNDAMENTAL DE 9 ANOS - 5\xba ANO': '5_EF',
    'ENSINO FUNDAMENTAL DE 9 ANOS - 9\xba ANO': '9_EF',
    'ENSINO MEDIO - 3\xaa SERIE': '3_EM',
    'ENSINO MEDIO - 3\xba SERIE': '3_EM',
    'ENSINO FUNDAMENTAL DE 9 ANOS - 2\u00ba ANO': '2_EF',
    'ENSINO FUNDAMENTAL DE 9 ANOS - 5\u00ba ANO': '5_EF',
    'ENSINO FUNDAMENTAL DE 9 ANOS - 9\u00ba ANO': '9_EF',
    'ENSINO MEDIO - 3\u00aa SERIE': '3_EM',
    'ENSINO MEDIO - 3\u00ba SERIE': '3_EM',
}

DISC_MAP = {
    'L\xedngua Portuguesa': 'LP',
    'Matem\xe1tica': 'MT',
    'L\u00edngua Portuguesa': 'LP',
    'Matem\u00e1tica': 'MT',
    'Lingua Portuguesa': 'LP',
    'Matematica': 'MT',
}

PADRAO_ADEQ = {'Adequado', 'Avan\xe7ado', 'Avan\u00e7ado', 'Avancado', 'Avançado'}

TURNO_MAP = {
    'MANHA': 'Manhã',
    'TARDE': 'Tarde',
    'NOITE': 'Noite',
    'INTEGRAL': 'Integral',
}


class Aggregator:
    def __init__(self):
        self.sum_prof = 0.0
        self.count = 0
        self.adeq_avancado = 0
        self.total_padrao = 0
    
    def add(self, prof, padrao):
        if prof is not None:
            self.sum_prof += prof
            self.count += 1
        if padrao:
            self.total_padrao += 1
            if padrao in PADRAO_ADEQ:
                self.adeq_avancado += 1
    
    def to_dict(self):
        # Minimum N constraint: N >= 10 for averages to be statistically valid
        if self.count < 10:
            return None
        return {
            'media': round(self.sum_prof / self.count, 1),
            'n': self.count,
            'pct_adeq_av': round(self.adeq_avancado / self.total_padrao * 100, 1) if self.total_padrao > 0 else None,
            'n_padrao': self.total_padrao,
        }

def extract_cre_code(nm_regional):
    if not nm_regional: return None
    parts = nm_regional.split('\xaa')
    if len(parts) < 2: parts = nm_regional.split('\u00aa')
    if len(parts) < 2: parts = nm_regional.split('\xba')
    if len(parts) < 2: parts = nm_regional.split('\u00ba')
    if len(parts) >= 2: return parts[0].strip()
    num = ''
    for c in nm_regional:
        if c.isdigit(): num += c
        else: break
    return num if num else None

def extract_cre_name(nm_regional):
    if not nm_regional: return None
    idx = nm_regional.find(' - ')
    if idx >= 0: return nm_regional[idx+3:].strip().title()
    return nm_regional.strip()

def get_empty_block():
    return {
        'geral': defaultdict(Aggregator),
        'dimensoes': defaultdict(lambda: defaultdict(lambda: defaultdict(Aggregator)))
    }

def block_to_dict(block):
    result = {'geral': {}, 'dimensoes': {}}
    for key, agg in block['geral'].items():
        d = agg.to_dict()
        if d: result['geral'][key] = d
    for dim_name, groups in block['dimensoes'].items():
        dim_res = {}
        for group_name, etapa_discs in groups.items():
            grp_res = {}
            for key, agg in etapa_discs.items():
                d = agg.to_dict()
                if d: grp_res[key] = d
            if grp_res: dim_res[group_name] = grp_res
        if dim_res: result['dimensoes'][dim_name] = dim_res
    
    if not result['geral'] and not result['dimensoes']:
        return None
    return result

def process_year(ano):
    filepath = SAERS_DIR / f'SAERS_{ano}.csv'
    if not filepath.exists():
        print(f'  SKIP: {filepath} not found')
        return None
    
    print(f'  Processando {filepath.name} ({filepath.stat().st_size / 1024 / 1024:.0f} MB)...')
    
    estado = get_empty_block()
    por_cre = defaultdict(get_empty_block)
    por_municipio = defaultdict(get_empty_block)
    
    cre_lookup = {}
    n_total = 0
    n_avaliados = 0
    
    for enc in ['utf-8', 'latin-1']:
        try:
            with open(filepath, 'r', encoding=enc) as f:
                reader = csv.DictReader(f, delimiter=';')
                for row in reader:
                    n_total += 1
                    if row.get('FL_AVALIADO', '') != '1': continue
                    prof_str = row.get('VL_PROFICIENCIA', '').strip()
                    if not prof_str: continue
                    try: prof = float(prof_str.replace(',', '.'))
                    except: continue
                    
                    etapa_raw = row.get('DC_ETAPA_AVALIADA', '')
                    disc_raw = row.get('NM_DISCIPLINA', '')
                    etapa = ETAPA_MAP.get(etapa_raw)
                    disc = DISC_MAP.get(disc_raw)
                    if not etapa or not disc: continue
                    
                    n_avaliados += 1
                    key = f'{etapa}_{disc}'
                    padrao = row.get('DC_PADRAO_DESEMPENHO', '').strip()
                    
                    blocks = [estado]
                    
                    nm_reg = row.get('NM_REGIONAL', '').strip()
                    cre_code = extract_cre_code(nm_reg)
                    if cre_code:
                        blocks.append(por_cre[cre_code])
                        if cre_code not in cre_lookup: cre_lookup[cre_code] = extract_cre_name(nm_reg)
                    
                    mun_name = row.get('NM_MUNICIPIO', '').strip()
                    if mun_name:
                        blocks.append(por_municipio[mun_name.title()])
                    
                    raca_raw = (row.get('DC_RACA') or row.get('DC_COR_RACA') or '').strip()
                    raca = RACA_MAP.get(raca_raw)
                    sexo = SEXO_MAP.get(row.get('DC_SEXO', '').strip())
                    loc_raw = row.get('DC_LOCALIZACAO', '').strip()
                    loc = 'Urbana' if loc_raw.upper() == 'URBANA' else ('Rural' if loc_raw.upper() == 'RURAL' else None)
                    defic = row.get('TIPO_DEFICIENCIA', '').strip()
                    grupo_def = 'Com deficiência' if defic else 'Sem deficiência'
                    turno = TURNO_MAP.get(row.get('DC_TURNO', '').strip())
                    
                    for block in blocks:
                        block['geral'][key].add(prof, padrao)
                        if raca: block['dimensoes']['raca'][raca][key].add(prof, padrao)
                        if sexo: block['dimensoes']['sexo'][sexo][key].add(prof, padrao)
                        if loc: block['dimensoes']['localizacao'][loc][key].add(prof, padrao)
                        if ano == 2025:  # Somente 2025 tem dados consistentes de deficiência
                            block['dimensoes']['deficiencia'][grupo_def][key].add(prof, padrao)
                        if turno: block['dimensoes']['turno'][turno][key].add(prof, padrao)
                        
                    if cre_code:
                        estado['dimensoes']['cre'][cre_code][key].add(prof, padrao)
                    
                    if raca and loc in ('Urbana', 'Rural'):
                        inter_key = f'{raca} - {loc}'
                        for block in blocks:
                            block['dimensoes']['raca_loc'][inter_key][key].add(prof, padrao)

                    if n_total % 2_000_000 == 0:
                        print(f'    ... {n_total:,} linhas processadas, {n_avaliados:,} avaliados')
            break
        except UnicodeDecodeError:
            continue
    
    print(f'    Total: {n_total:,} linhas, {n_avaliados:,} avaliados')
    
    result = {
        'ano': ano,
        'total_registros': n_total,
        'total_avaliados': n_avaliados,
        'cre_lookup': cre_lookup,
        'geral': {},
        'dimensoes': {},
        'por_cre': {},
        'por_municipio': {}
    }
    
    res_estado = block_to_dict(estado)
    if res_estado:
        result['geral'] = res_estado['geral']
        result['dimensoes'] = res_estado['dimensoes']
        
    for c, blk in por_cre.items():
        res = block_to_dict(blk)
        if res: result['por_cre'][c] = res
        
    for m, blk in por_municipio.items():
        res = block_to_dict(blk)
        if res: result['por_municipio'][m] = res
        
    return result

def main():
    print('=== ETL Desigualdades SAERS ===')
    output = {
        'metadata': {
            'titulo': 'Desigualdades Educacionais — SAERS',
            'fonte': 'SAERS/CAED — Microdados da Avaliação do Estado do Rio Grande do Sul',
            'dimensoes': {
                'raca': 'Raça/Cor',
                'sexo': 'Sexo',
                'localizacao': 'Localização (Urbana/Rural)',
                'deficiencia': 'Deficiência',
                'turno': 'Turno',
                'cre': 'Coordenadoria Regional de Educação',
                'raca_loc': 'Raça/Cor × Localização',
            },
            'etapa_labels': {
                '2_EF': '2º ano EF',
                '5_EF': '5º ano EF',
                '9_EF': '9º ano EF',
                '3_EM': '3ª série EM',
            },
            'disc_labels': {
                'LP': 'Língua Portuguesa',
                'MT': 'Matemática',
            },
        },
        'anos': [],
    }
    for ano in ANOS:
        print(f'\n[{ano}]')
        year_data = process_year(ano)
        if year_data:
            output['anos'].append(year_data)
    print(f'\nGravando {OUTPUT}...')
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=None, separators=(',', ':'))
    size_mb = OUTPUT.stat().st_size / 1024 / 1024
    print(f'OK: {OUTPUT.name} ({size_mb:.1f} MB)')

if __name__ == '__main__':
    main()
