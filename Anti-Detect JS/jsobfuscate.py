#!/usr/bin/env python3
"""
jsobfuscate.py — Nuclear-grade JavaScript obfuscator written in Python.
Usage:
    python3 jsobfuscate.py input.js                 # prints to stdout
    python3 jsobfuscate.py input.js -o output.js    # writes to file
    python3 jsobfuscate.py input.js -o output.js --seed 42  # reproducible
    python3 jsobfuscate.py input.js -o output.js --layers 3 # multi-layer packing
"""

import re
import sys
import random
import string
import base64
import hashlib
import argparse
import os
import zlib
import struct
import math

# ─────────────────────────────────────────────
# UTILITY HELPERS
# ─────────────────────────────────────────────

def _rand_hex(length=6):
    return ''.join(random.choices('0123456789abcdef', k=length))

def _rand_var():
    return f'_0x{_rand_hex(4)}'

def _rand_label():
    return f'_0x{_rand_hex(6)}'

def _rand_str(length=8):
    return ''.join(random.choices(string.ascii_letters, k=length))

# JS keywords & built-ins that must NEVER be renamed
JS_RESERVED = {
    'break','case','catch','continue','debugger','default','delete','do',
    'else','finally','for','function','if','in','instanceof','new','return',
    'switch','this','throw','try','typeof','var','void','while','with',
    'class','const','enum','export','extends','import','super','implements',
    'interface','let','package','private','protected','public','static','yield',
    'await','async','of','get','set','from','as','true','false','null','undefined',
    'console','window','document','navigator','location','history','screen',
    'alert','prompt','confirm','setTimeout','setInterval','clearTimeout',
    'clearInterval','requestAnimationFrame','cancelAnimationFrame',
    'parseInt','parseFloat','isNaN','isFinite','decodeURI','decodeURIComponent',
    'encodeURI','encodeURIComponent','escape','unescape','eval',
    'Object','Array','String','Number','Boolean','Function','Symbol','BigInt',
    'RegExp','Date','Error','TypeError','RangeError','SyntaxError',
    'ReferenceError','URIError','EvalError','Map','Set','WeakMap','WeakSet',
    'Promise','Proxy','Reflect','JSON','Math','Intl','ArrayBuffer',
    'SharedArrayBuffer','DataView','Float32Array','Float64Array',
    'Int8Array','Int16Array','Int32Array','Uint8Array','Uint8ClampedArray',
    'Uint16Array','Uint32Array','Atomics','WebAssembly',
    'globalThis','process','require','module','exports','__dirname','__filename',
    'Buffer','global','fetch','Response','Request','Headers','URL','URLSearchParams',
    'TextEncoder','TextDecoder','AbortController','AbortSignal','Event',
    'EventTarget','CustomEvent','FormData','Blob','File','FileReader',
    'XMLHttpRequest','WebSocket','Worker','MessageChannel','MessagePort',
    'ReadableStream','WritableStream','TransformStream',
    'constructor','prototype','__proto__','hasOwnProperty','toString','valueOf',
    'length','name','arguments','caller','callee','apply','bind','call',
    'NaN','Infinity','atob','btoa','CharacterData',
}

# ─────────────────────────────────────────────
# PASS: WHITESPACE & COMMENT STRIPPING
# ─────────────────────────────────────────────

def pass_minify(code):
    """Remove comments and collapse whitespace."""
    code = re.sub(r'(?<!:)//.*?$', '', code, flags=re.MULTILINE)
    code = re.sub(r'/\*[\s\S]*?\*/', '', code)
    code = re.sub(r'\n\s*\n', '\n', code)
    code = re.sub(r'[ \t]+', ' ', code)
    lines = [l.strip() for l in code.split('\n') if l.strip()]
    return '\n'.join(lines)

# ─────────────────────────────────────────────
# PASS: DOT NOTATION → BRACKET ACCESS
# ─────────────────────────────────────────────

def pass_dot_to_bracket(code):
    """Convert obj.property to obj["property"]."""
    pattern = re.compile(r'\.([a-zA-Z_$][a-zA-Z0-9_$]*)\b(?!\s*[:(])')
    def _replace(m):
        prop = m.group(1)
        if prop in JS_RESERVED or len(prop) < 2:
            return m.group(0)
        if random.random() < 0.7:
            return f'["{prop}"]'
        return m.group(0)
    return pattern.sub(_replace, code)

# ─────────────────────────────────────────────
# PASS: STRING EXTRACTION & RC4 ENCRYPTION
# ─────────────────────────────────────────────

def _rc4(key, data):
    S = list(range(256))
    j = 0
    for i in range(256):
        j = (j + S[i] + ord(key[i % len(key)])) % 256
        S[i], S[j] = S[j], S[i]
    i = j = 0
    out = []
    for ch in data:
        i = (i + 1) % 256
        j = (j + S[i]) % 256
        S[i], S[j] = S[j], S[i]
        out.append(chr(ord(ch) ^ S[(S[i] + S[j]) % 256]))
    return ''.join(out)

def pass_string_extraction(code):
    """Extract ALL string literals into a rotated, RC4-encrypted string array."""
    strings = []
    str_pattern = re.compile(r"""(?<!\\)(["'])(?:(?!\1|\\).|\\.)*?\1""", re.DOTALL)
    seen = {}

    def _collect(m):
        s = m.group(0)
        raw = s[1:-1]
        if raw not in seen:
            seen[raw] = len(strings)
            strings.append(raw)
        return s
    str_pattern.sub(_collect, code)

    if not strings:
        return code

    rc4_key = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
    rotation_amount = random.randint(1, max(1, len(strings) - 1))
    arr_name = _rand_var()
    dec_name = _rand_var()
    rot_name = _rand_var()

    encrypted = []
    for s in strings:
        enc = _rc4(rc4_key, s)
        b64 = base64.b64encode(enc.encode('latin-1')).decode('ascii')
        encrypted.append(b64)

    rotated = encrypted[rotation_amount:] + encrypted[:rotation_amount]
    arr_literal = '[' + ','.join(f'"{e}"' for e in rotated) + ']'

    decoder_js = f"""var {arr_name}={arr_literal};
(function({rot_name},_0xc2){{var _0xc3=function(_0xc4){{while(--_0xc4){{{rot_name}.push({rot_name}.shift());}}}};_0xc3(++_0xc2);}})({arr_name},{rotation_amount});
var {dec_name}=function(_0xi,_0xk){{_0xi=_0xi-0x0;var _0xs={arr_name}[_0xi];if({dec_name}.initialized===undefined){{var _0xrc4=function(_0xk2,_0xd){{var _0xS=[];var _0xr='';var _0xt,_0xi2=0,_0xj=0,_0xo='';for(var _0xi3=0;_0xi3<256;_0xi3++){{_0xS[_0xi3]=_0xi3;}}for(_0xi3=0;_0xi3<256;_0xi3++){{_0xj=(_0xj+_0xS[_0xi3]+_0xk2.charCodeAt(_0xi3%_0xk2.length))%256;_0xt=_0xS[_0xi3];_0xS[_0xi3]=_0xS[_0xj];_0xS[_0xj]=_0xt;}}_0xi3=0;_0xj=0;for(var _0xy=0;_0xy<_0xd.length;_0xy++){{_0xi3=(_0xi3+1)%256;_0xj=(_0xj+_0xS[_0xi3])%256;_0xt=_0xS[_0xi3];_0xS[_0xi3]=_0xS[_0xj];_0xS[_0xj]=_0xt;_0xr+=String.fromCharCode(_0xd.charCodeAt(_0xy)^_0xS[(_0xS[_0xi3]+_0xS[_0xj])%256]);}}return _0xr;}};var _0xatob=typeof atob!=='undefined'?atob:function(_0xb){{var _0xc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';var _0xo='';for(var _0xi4=0,_0xa,_0xb2,_0xe=0;_0xb2=_0xb.charAt(_0xe++);~_0xb2&&(_0xa=_0xi4%4?_0xa*64+_0xb2:_0xb2,_0xi4++%4)?_0xo+=String.fromCharCode(255&_0xa>>(-2*_0xi4&6)):0){{_0xb2=_0xc.indexOf(_0xb2);}}return _0xo;}};{dec_name}.rc4=_0xrc4;{dec_name}.data={{}};{dec_name}.initialized=true;}};var _0xcached={dec_name}.data[_0xi];if(_0xcached===undefined){{_0xs={dec_name}.rc4('{rc4_key}',_0xatob(_0xs));{dec_name}.data[_0xi]=_0xs;}}else{{_0xs=_0xcached;}}return _0xs;}};
"""

    def _replace(m):
        raw = m.group(0)[1:-1]
        if raw in seen:
            idx = seen[raw]
            return f'{dec_name}(0x{idx:x})'
        return m.group(0)

    new_code = str_pattern.sub(_replace, code)
    return decoder_js + new_code

# ───────────────────────────────────────────���─
# PASS: STRING SPLITTING
# ─────────────────────────────────────────────

def pass_string_splitting(code):
    """Split remaining string literals into concatenated chunks."""
    str_pattern = re.compile(r"""(?<!\\)"((?:[^"\\]|\\.){6,})"(?!\s*[:\]])""")

    def _split(m):
        raw = m.group(1)
        if len(raw) < 6:
            return m.group(0)
        chunks = []
        i = 0
        while i < len(raw):
            chunk_size = random.randint(2, 5)
            chunks.append(raw[i:i+chunk_size])
            i += chunk_size
        return '(' + '+'.join(f'"{c}"' for c in chunks) + ')'

    return str_pattern.sub(_split, code)

# ─────────────────────────────────────────────
# PASS: IDENTIFIER MANGLING
# ─────────────────────────────────────────────

def pass_identifier_mangling(code):
    """Rename user-defined variables/functions to hex names."""
    decl_pattern = re.compile(r'\b(?:var|let|const|function)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)')
    param_pattern = re.compile(r'function\s*[a-zA-Z_$][a-zA-Z0-9_$]*?\s*\(([^)]*)\)')
    arrow_param_pattern = re.compile(r'\(([^)]*)\)\s*=>')

    identifiers = set()

    for m in decl_pattern.finditer(code):
        name = m.group(1)
        if name not in JS_RESERVED:
            identifiers.add(name)

    for pat in [param_pattern, arrow_param_pattern]:
        for m in pat.finditer(code):
            params = m.group(1)
            for p in params.split(','):
                p = p.strip().split('=')[0].strip()
                if p and p not in JS_RESERVED:
                    identifiers.add(p)

    if not identifiers:
        return code

    sorted_ids = sorted(identifiers, key=len, reverse=True)
    rename_map = {}
    used = set()
    for ident in sorted_ids:
        new_name = _rand_var()
        while new_name in used:
            new_name = _rand_var()
        used.add(new_name)
        rename_map[ident] = new_name

    for old, new in rename_map.items():
        code = re.sub(r'\b' + re.escape(old) + r'\b', new, code)

    return code

# ─────────────────────────────────────────────
# PASS: OPAQUE PREDICATES
# ───────────────────────────────��─────────────

def pass_opaque_predicates(code):
    """
    Wrap code blocks in opaque predicates — conditions that are
    always true/false but computationally hard to prove statically.
    """
    # Math-based predicates that are ALWAYS TRUE
    always_true = [
        lambda: f'((Math.pow({random.randint(2,20)},2)-{random.randint(2,20)**2-1})>0)',
        lambda: f'(({_rand_var()}=0x{_rand_hex(2)},({_rand_var()}*{_rand_var()}+{_rand_var()})%2===({_rand_var()}*{_rand_var()}+{_rand_var()})%2)||true)',
        lambda: f'(typeof undefined==="undefined")',
        lambda: f'((+![])===0)',
        lambda: f'(NaN!==NaN)',
        lambda: f'(void 0===undefined)',
        lambda: f'([][{_rand_var()}={_rand_hex(3)}]===undefined||true)',
        lambda: f'(((0x{_rand_hex(4)}^0x{_rand_hex(4)})>=0)||true)',
        lambda: f'(Object.keys({{}})[{_rand_var()}="length"]!==undefined||true)',
        lambda: f'((typeof NaN)==="number")',
        lambda: f'((-~[])===(+!+[]))',  # -~[] === 1 === +!+[]
        lambda: f'(({{}}+[])[0]==="["||({{}}+[])[0]==="o"||true)',
    ]

    lines = code.split('\n')
    new_lines = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if (stripped and
            not stripped.startswith('var ') and
            not stripped.startswith('let ') and
            not stripped.startswith('const ') and
            not stripped.startswith('function') and
            not stripped.startswith('//') and
            not stripped.startswith('{') and
            not stripped.startswith('}') and
            not stripped.startswith('case ') and
            not stripped.startswith('continue') and
            not stripped.startswith('break') and
            random.random() < 0.25):
            pred = random.choice(always_true)()
            new_lines.append(f'if({pred}){{{line}}}')
        else:
            new_lines.append(line)
    return '\n'.join(new_lines)

# ─────────────────────────────────────────────
# PASS: MIXED BOOLEAN-ARITHMETIC (MBA)
# ─────────────────────────────────────────────

def pass_mba_expressions(code):
    """
    Replace simple arithmetic with MBA (Mixed Boolean-Arithmetic)
    expressions — computationally equivalent but extremely hard
    to simplify statically.
    """
    def _mba_add(a, b):
        """a + b = (a ^ b) + 2 * (a & b)"""
        return f'(({a}^{b})+2*({a}&{b}))'

    def _mba_sub(a, b):
        """a - b = (a ^ b) - 2 * (~a & b)"""
        return f'(({a}^{b})-2*(~{a}&{b}))'

    def _mba_xor(a, b):
        """a ^ b = (a | b) - (a & b)"""
        return f'(({a}|{b})-({a}&{b}))'

    def _mba_identity(x):
        """x = (x & c) | (x & ~c) for random constant c"""
        c = random.randint(1, 0xFFFF)
        return f'(({x}&{c})|({x}&~{c}))'

    # Replace patterns like `expr + expr`, `expr - expr`
    # We do this on number-heavy lines
    def _replace_add(m):
        a = m.group(1)
        b = m.group(2)
        if random.random() < 0.4:
            return _mba_add(a, b)
        return m.group(0)

    def _replace_sub(m):
        a = m.group(1)
        b = m.group(2)
        if random.random() < 0.4:
            return _mba_sub(a, b)
        return m.group(0)

    # Simple patterns: number+number, var+number
    code = re.sub(r'(0x[0-9a-f]+)\s*\+\s*(0x[0-9a-f]+)', _replace_add, code)
    code = re.sub(r'(0x[0-9a-f]+)\s*-\s*(0x[0-9a-f]+)', _replace_sub, code)

    return code

# ─────────────────────────────────────────────
# PASS: PROXY FUNCTION WRAPPING
# ─────────────────────────────────────────────

def pass_proxy_functions(code):
    """
    Create proxy functions that wrap common operations.
    Instead of `a + b`, call `_0xProxy1(a, b)`.
    Adds layers of indirection.
    """
    proxy_defs = []
    proxy_map = {}

    # Generate proxy functions for common operations
    ops = [
        ('+', 'add'),
        ('-', 'sub'),
        ('*', 'mul'),
        ('===', 'seq'),
        ('!==', 'sne'),
        ('>', 'gt'),
        ('<', 'lt'),
    ]

    for op, label in ops:
        fname = _rand_var()
        proxy_map[op] = fname
        if op in ['+', '-', '*']:
            proxy_defs.append(f'var {fname}=function(_0xa,_0xb){{return _0xa{op}_0xb;}};')
        else:
            proxy_defs.append(f'var {fname}=function(_0xa,_0xb){{return _0xa{op}_0xb;}};')

    # Nest some proxies — proxy calling proxy
    nested = []
    for op, label in ops[:3]:
        wrapper = _rand_var()
        inner = proxy_map[op]
        nested.append(f'var {wrapper}=function(_0xp,_0xq){{return {inner}(_0xp,_0xq);}};')
        proxy_map[op] = wrapper  # update to use the nested version

    proxy_header = '\n'.join(proxy_defs + nested)

    # Replace some binary operations in code with proxy calls
    def _wrap_op(match, op):
        left = match.group(1)
        right = match.group(2)
        if op in proxy_map and random.random() < 0.35:
            return f'{proxy_map[op]}({left},{right})'
        return match.group(0)

    # Apply proxy replacements
    for op, label in ops:
        escaped = re.escape(op)
        pattern = re.compile(r'(\b[a-zA-Z_$][a-zA-Z0-9_$]*\b)\s*' + escaped + r'\s*(\b[a-zA-Z_$][a-zA-Z0-9_$]*\b)')
        code = pattern.sub(lambda m, o=op: _wrap_op(m, o), code)

    return proxy_header + '\n' + code

# ─────────────────────────────────────────────
# PASS: DEAD CODE INJECTION (ENHANCED)
# ─────────────────────────────────────────────

def _generate_dead_code():
    templates = [
        lambda: f'if(typeof {_rand_var()}!=="undefined"&&{_rand_var()}.{_rand_var()}){{var {_rand_var()}=Math.floor(Math.random()*0x{_rand_hex(4)});for(var {_rand_var()}=0x0;{_rand_var()}<{random.randint(3,20)};{_rand_var()}++){{{_rand_var()}+=0x{_rand_hex(2)};}}}}',
        lambda: f'var {_rand_var()}=function(){{var {_rand_var()}=[{",".join(["0x"+_rand_hex(2) for _ in range(random.randint(3,8))])}];return {_rand_var()}[Math.floor(Math.random()*{_rand_var()}.length)];}};',
        lambda: f'try{{if(typeof {_rand_var()}==="function"){{{_rand_var()}({",".join(["0x"+_rand_hex(3) for _ in range(random.randint(1,4))])});}}}}catch({_rand_var()}){{void 0x0;}}',
        lambda: f'switch(Math.floor(Math.random()*0x{_rand_hex(2)})){{case 0x0:break;case 0x1:void 0x0;break;default:break;}}',
        lambda: f'void function(){{var {_rand_var()}=Date.now()^0x{_rand_hex(6)};if({_rand_var()}<0x0){{{_rand_var()}=~{_rand_var()};}}}}();',
        lambda: (lambda v1=_rand_var(), v2=_rand_var():
            f'var {v1}=function({v2}){{return arguments.length>0x1?{v2}^0x{_rand_hex(4)}:{v2}>>>0x{random.randint(1,5)};}};')(),
        lambda: (lambda v1=_rand_var(), v2=_rand_var(), v3=_rand_var():
            f'var {v1}=[{",".join(str(random.randint(0,255)) for _ in range(random.randint(5,15)))}];var {v2}={v1}.reduce(function({v3},_0xc){{return {v3}^_0xc;}},0x0);void {v2};')(),
        lambda: f'(function(){{var {_rand_var()}=new Array(0x{_rand_hex(2)});for(var {_rand_var()}=0x0;{_rand_var()}<{_rand_var()}.length;{_rand_var()}++){{{_rand_var()}[{_rand_var()}]={_rand_var()}^0x{_rand_hex(3)};}}return {_rand_var()};}})()',
    ]
    return random.choice(templates)()

def pass_dead_code_injection(code, density=6):
    lines = code.split('\n')
    new_lines = []
    for i, line in enumerate(lines):
        new_lines.append(line)
        if i % max(1, len(lines) // density) == 0 and line.strip() and not line.strip().startswith('//'):
            # Inject 1-3 dead code blocks in a row
            for _ in range(random.randint(1, 3)):
                new_lines.append(_generate_dead_code())
    return '\n'.join(new_lines)

# ─────────────────────────────────────────────
# PASS: CONTROL FLOW FLATTENING (ENHANCED)
# ─────────────────────────────────────────────

def pass_control_flow_flattening(code):
    """
    Enhanced CFF with nested dispatchers and fake states.
    """
    lines = code.split('\n')
    blocks = []
    current = []
    for line in lines:
        current.append(line)
        if len(current) >= random.randint(2, 4):
            blocks.append('\n'.join(current))
            current = []
    if current:
        blocks.append('\n'.join(current))

    if len(blocks) < 3:
        return code

    # Add fake blocks
    num_fake = random.randint(2, 5)
    for _ in range(num_fake):
        blocks.append(_generate_dead_code())

    real_count = len(blocks) - num_fake
    order = list(range(len(blocks)))
    execution_order = list(range(real_count))
    random.shuffle(order)

    label_map = {}
    for i, o in enumerate(order):
        label_map[o] = i

    state_var = _rand_var()
    order_arr = _rand_var()
    counter_var = _rand_var()
    dispatch_obj = _rand_var()

    order_str = '|'.join(str(label_map[i]) for i in execution_order)

    cases = []
    for idx in range(len(blocks)):
        case_label = label_map[idx]
        cases.append(f'case {case_label}:{blocks[idx]}\ncontinue;')

    random.shuffle(cases)

    # Nested dispatcher: inner switch wrapped in outer function
    inner_fn = _rand_var()

    flattened = f"""(function(){{
var {order_arr}='{order_str}'.split('|'),{counter_var}=0x0;
var {dispatch_obj}={{{','.join(f"'{_rand_hex(4)}':function(_0xa,_0xb){{return _0xa+_0xb;}}" for _ in range(random.randint(2,5)))}}};
var {inner_fn}=function({state_var}){{
switch({state_var}){{
{chr(10).join(cases)}
}}
}};
while(true){{
if({counter_var}>={order_arr}.length)break;
{inner_fn}(+{order_arr}[{counter_var}++]);
}}
}})();"""

    return flattened

# ─────────────────────────────────────────────
# PASS: CODE TRAMPOLINING
# ─────────────────────────────────────────────

def pass_trampolining(code):
    """
    Wrap chunks of code in function trampolines — each block
    is a function that calls the next block, creating a chain
    of indirect calls instead of linear execution.
    """
    lines = code.split('\n')
    # Group into blocks
    blocks = []
    current = []
    for line in lines:
        current.append(line)
        if len(current) >= random.randint(3, 6):
            blocks.append('\n'.join(current))
            current = []
    if current:
        blocks.append('\n'.join(current))

    if len(blocks) < 2:
        return code

    # Create trampoline chain
    func_names = [_rand_var() for _ in range(len(blocks))]

    result_parts = []

    for i, block in enumerate(blocks):
        next_call = f'{func_names[i+1]}();' if i < len(blocks) - 1 else ''
        result_parts.append(f'var {func_names[i]}=function(){{{block}\n{next_call}}};')

    # Start the chain
    result_parts.append(f'{func_names[0]}();')

    return '\n'.join(result_parts)

# ─────────────────────────────────────────────
# PASS: SCOPE POLLUTION
# ─────────────────────────────────────────────

def pass_scope_pollution(code):
    """
    Inject dozens of fake global variables with meaningless
    values to pollute the scope and confuse analysis tools.
    """
    pollution = []
    num_vars = random.randint(20, 50)
    for _ in range(num_vars):
        vname = _rand_var()
        vtype = random.choice(['num', 'str', 'arr', 'obj', 'fn', 'bool', 'undef'])
        if vtype == 'num':
            pollution.append(f'var {vname}=0x{_rand_hex(random.randint(2,8))};')
        elif vtype == 'str':
            pollution.append(f'var {vname}="{"".join(random.choices(string.ascii_letters, k=random.randint(5,20)))}";')
        elif vtype == 'arr':
            arr = ','.join(f'0x{_rand_hex(2)}' for _ in range(random.randint(3,10)))
            pollution.append(f'var {vname}=[{arr}];')
        elif vtype == 'obj':
            keys = ','.join(f'"{_rand_hex(4)}":0x{_rand_hex(2)}' for _ in range(random.randint(2,5)))
            pollution.append(f'var {vname}={{{keys}}};')
        elif vtype == 'fn':
            p = _rand_var()
            pollution.append(f'var {vname}=function({p}){{return {p}^0x{_rand_hex(4)};}};')
        elif vtype == 'bool':
            pollution.append(f'var {vname}={"!![]" if random.random() < 0.5 else "![]"};')
        else:
            pollution.append(f'var {vname}=void 0x0;')

    random.shuffle(pollution)
    # Insert half at top, half scattered
    top_half = pollution[:len(pollution)//2]
    bottom_half = pollution[len(pollution)//2:]

    lines = code.split('\n')
    new_lines = list(top_half)
    insert_points = sorted(random.sample(range(len(lines)), min(len(bottom_half), len(lines))))

    bi = 0
    for i, line in enumerate(lines):
        new_lines.append(line)
        if bi < len(bottom_half) and i in insert_points:
            new_lines.append(bottom_half[bi])
            bi += 1

    return '\n'.join(new_lines)

# ─────────────────────────────────────────────
# PASS: EXPRESSION OBFUSCATION
# ─────────────────────────────────────────────

def _obfuscate_number(n):
    strategies = [
        lambda n: f'(0x{n:x})',
        lambda n: f'({n+random.randint(1,100)}-{random.randint(1,100)}+{n - (n+random.randint(1,100)-random.randint(1,100))})',
        lambda n: f'(+("0x{n:x}"))',
        lambda n: f'(~~{float(n)})',
        lambda n: f'({n}|0x0)',
        lambda n: f'(({n}^0x0))',
        lambda n: f'((0x{_rand_hex(4)}^0x{_rand_hex(4)})>=0?{n}:void 0x0)',
    ]
    if n == 0:
        return random.choice(['(+[])', '(0x0)', '(+"")', '(-~[]+~[])'])
    if n == 1:
        return random.choice(['(+!+[])', '(0x1)', '(-~[])'])
    try:
        return random.choice(strategies)(n)
    except:
        return str(n)

def pass_expression_obfuscation(code):
    code = re.sub(r'\btrue\b', '(![])', code)
    code = re.sub(r'\bfalse\b', '(!![])', code)

    def _replace_num(m):
        prefix = m.string[max(0,m.start()-2):m.start()]
        if prefix.endswith('0x') or prefix.endswith('0X'):
            return m.group(0)
        if re.search(r'[a-zA-Z_$]$', prefix):
            return m.group(0)
        try:
            n = int(m.group(0))
            if 0 <= n <= 255:
                return _obfuscate_number(n)
        except:
            pass
        return m.group(0)

    code = re.sub(r'\b(\d{1,3})\b', _replace_num, code)
    return code

# ─────────────────────────────────────────────
# PASS: ENVIRONMENT FINGERPRINTING / LOCK
# ─────────────────────────────────────────────

def pass_environment_fingerprint(code):
    """
    Inject environment fingerprinting that makes the code
    behave differently (or break) in analysis environments.
    Detects: Node.js debugger, headless browsers, VMs, etc.
    """
    fp_var = _rand_var()
    check_var = _rand_var()
    trap_var = _rand_var()

    fingerprint = f"""
(function(){{
    var {fp_var}=function(){{
        var _0xenv=0x0;
        try{{
            if(typeof window!=='undefined'){{
                if(window.outerWidth===0||window.outerHeight===0)_0xenv|=0x1;
                if(window.navigator&&/headless/i.test(window.navigator.userAgent||''))_0xenv|=0x2;
                if(window.navigator&&window.navigator.webdriver)_0xenv|=0x4;
                if(window.callPhantom||window._phantom)_0xenv|=0x8;
                if(window.__nightmare)_0xenv|=0x10;
                if(document.documentElement&&document.documentElement.getAttribute('webdriver'))_0xenv|=0x20;
                var _0xthreshold=window.performance&&window.performance.timing?(window.performance.timing.domComplete-window.performance.timing.navigationStart):0x0;
                if(_0xthreshold<0x0)_0xenv|=0x40;
            }}
        }}catch(_0xe){{}}
        try{{
            if(typeof process!=='undefined'){{
                if(process.env&&(process.env.NODE_DEBUG||process.env.DEBUG))_0xenv|=0x80;
                var _0xargv=(process.execArgv||[]).join(' ');
                if(/--inspect|--debug/i.test(_0xargv))_0xenv|=0x100;
            }}
        }}catch(_0xe2){{}}
        return _0xenv;
    }};
    var {check_var}={fp_var}();
    if({check_var}>0x0){{
        var {trap_var}=setInterval(function(){{
            (function(){{return false;}}).constructor('debugger')();
        }},0x32);
    }}
}})();
"""
    return fingerprint + code

# ─────────────────────────────────────────────
# PASS: ANTI-DEBUGGING (ENHANCED)
# ─────────────────────────────────────────────

def pass_anti_debug(code):
    trap_var1 = _rand_var()
    trap_fn = _rand_var()
    interval_var = _rand_var()
    counter_var = _rand_var()
    threshold_var = _rand_var()

    anti_debug = f"""
(function(){{
    var {counter_var}=0x0;
    var {threshold_var}=0x0;
    var {trap_fn}=function(){{
        var _0xstart=+new Date();
        (function(){{return false;}}).constructor('debugger')();
        var _0xend=+new Date();
        if((_0xend-_0xstart)>0x64){{
            {counter_var}++;
            if({counter_var}>0x3){{
                while(true){{}}
            }}
        }}
    }};
    var {interval_var}=setInterval(function(){{
        {trap_fn}();
        {threshold_var}++;
        if({threshold_var}>0x{_rand_hex(3)}){{
            clearInterval({interval_var});
            {interval_var}=setInterval(function(){{{trap_fn}();}},0x{_rand_hex(3)});
        }}
    }},0x{random.randint(500,3000):x});
}})();
(function(){{
    var {_rand_var()}=Function.prototype.toString;
    try{{
        Function.prototype.toString=function(){{
            if(this===Function.prototype.toString){{
                (function(){{return false;}}).constructor('debugger')();
            }}
            return {_rand_var()}.apply(this,arguments);
        }};
    }}catch(_0x__){{}}
}})();
(function(){{
    var _0xcons=['log','warn','debug','info','error','exception','trace','dir','dirxml','table'];
    var _0xorig={{}};
    try{{
        for(var _0xi=0x0;_0xi<_0xcons.length;_0xi++){{
            (function(_0xmethod){{
                _0xorig[_0xmethod]=console[_0xmethod];
                console[_0xmethod]=function(){{
                    var _0xt1=+new Date();
                    _0xorig[_0xmethod].apply(console,arguments);
                    var _0xt2=+new Date();
                    if((_0xt2-_0xt1)>0x64){{
                        while(true){{(function(){{return false;}}).constructor('debugger')();}}
                    }}
                }};
            }})(_0xcons[_0xi]);
        }}
    }}catch(_0xe){{}}
}})();
"""
    return anti_debug + code

# ─────────────────────────────────────────────
# PASS: SELF-DEFENDING (ENHANCED)
# ─────────────────────────────────────────────

def pass_self_defending(code):
    sd_fn = _rand_var()
    test_var = _rand_var()
    re_var = _rand_var()
    hash_var = _rand_var()

    # Calculate a simple checksum of the code
    checksum = sum(ord(c) for c in code) & 0xFFFFFFFF

    wrapper = f"""
var {sd_fn}=function(){{
    var {test_var}=function(){{
        var {re_var}=new RegExp('\\n');
        return {re_var}.test({sd_fn}+'')?--[]:undefined;
    }};
    var {hash_var}=function(_0xcode){{
        var _0xh=0x0;
        for(var _0xi=0x0;_0xi<_0xcode.length;_0xi++){{
            var _0xch=_0xcode.charCodeAt(_0xi);
            _0xh=((_0xh<<0x5)-_0xh)+_0xch;
            _0xh|=0x0;
        }}
        return _0xh;
    }};
    try{{
        if({test_var}()){{
            return {test_var};
        }}
    }}catch(_0x__){{}}
}};
{sd_fn}();
(function(){{
    var _0xorigToStr=Function.prototype.toString;
    var _0xpattern=/\\b(beautif|deobfuscat|unpack|prettif|format|indent)/i;
    try{{
        var _0xerr=new Error();
        if(_0xerr.stack&&_0xpattern.test(_0xerr.stack)){{
            while(true){{}}
        }}
    }}catch(_0xe){{}}
}})();
"""
    return wrapper + code

# ─────────────────────────────────────────────
# PASS: CONSOLE DISABLING
# ─────────────────────────────────────────────

def pass_disable_console(code):
    c_var = _rand_var()
    console_kill = f"""
(function(){{
    var {c_var}=function(){{
        var _0xlog;
        try{{
            var _0xfn=(function(){{return this;}})().constructor('return this')();
            _0xlog=_0xfn.console||{{}};
        }}catch(_0xe){{
            _0xlog=console;
        }}
        var _0xm=['log','warn','info','error','exception','table','trace','dir',
                   'dirxml','group','groupCollapsed','groupEnd','clear','count',
                   'countReset','assert','profile','profileEnd','time','timeLog',
                   'timeEnd','timeStamp','context','createTask','memory'];
        for(var _0xi=0x0;_0xi<_0xm.length;_0xi++){{
            _0xlog[_0xm[_0xi]]=function(){{}};
        }}
    }};
    {c_var}();
}})();
"""
    return console_kill + code

# ─────────────────────────────────────────────
# PASS: UNICODE ESCAPE
# ─────────────────────────────────────────────

def pass_unicode_escape(code):
    def _encode_bracket_access(m):
        inner = m.group(1)
        encoded = ''.join(f'\\u{ord(c):04x}' for c in inner)
        return f'["{encoded}"]'
    code = re.sub(r'\["([a-zA-Z_$][a-zA-Z0-9_$]*)"\]', _encode_bracket_access, code)
    return code

# ──────────────────────��──────────────────────
# PASS: HEX ENCODING OF REMAINING STRINGS
# ─────────────────────────────────────────────

def pass_hex_strings(code):
    """Convert remaining short string literals to hex escape sequences."""
    str_pattern = re.compile(r'"([^"]{1,30})"')

    def _hex_encode(m):
        raw = m.group(1)
        # Don't encode if it looks like it's already encoded or is a number
        if '\\u' in raw or '\\x' in raw or raw.startswith('0x'):
            return m.group(0)
        if random.random() < 0.5:
            hexed = ''.join(f'\\x{ord(c):02x}' for c in raw)
            return f'"{hexed}"'
        return m.group(0)

    return str_pattern.sub(_hex_encode, code)

# ─────────────────────────────────────────────
# PASS: MULTI-LAYER PACKING
# ─────────────────────────────────────────────

def _pack_layer_b64_eval(code):
    """Base64 + eval layer."""
    b64 = base64.b64encode(code.encode('utf-8')).decode('ascii')
    chunks = []
    i = 0
    while i < len(b64):
        chunk_size = random.randint(30, 80)
        chunks.append(b64[i:i+chunk_size])
        i += chunk_size
    chunk_expr = '+'.join(f'"{c}"' for c in chunks)
    dec_var = _rand_var()
    return f'var {dec_var}=typeof atob!=="undefined"?atob:function(_0xb){{var _0xB=typeof Buffer!=="undefined"?Buffer:{{from:function(_0xs){{return{{toString:function(){{return _0xs}}}}}}}};return _0xB.from(_0xb,"base64").toString("utf-8")}};eval({dec_var}({chunk_expr}));'

def _pack_layer_char_code(code):
    """CharCode array + eval layer."""
    arr_name = _rand_var()
    codes = [str(ord(c)) for c in code]
    # Split into chunks and XOR with a key
    xor_key = random.randint(1, 255)
    xored = [str(ord(c) ^ xor_key) for c in code]
    return f'var {arr_name}=[{",".join(xored)}];eval({arr_name}.map(function(_0xc){{return String.fromCharCode(_0xc^{xor_key});}}).join(""));'

def _pack_layer_reverse_b64(code):
    """Reverse string + base64 layer."""
    b64 = base64.b64encode(code.encode('utf-8')).decode('ascii')
    reversed_b64 = b64[::-1]
    dec_var = _rand_var()
    rev_var = _rand_var()
    return f'var {rev_var}="{reversed_b64}";var {dec_var}=typeof atob!=="undefined"?atob:function(_0xb){{var _0xB=typeof Buffer!=="undefined"?Buffer:{{from:function(_0xs){{return{{toString:function(){{return _0xs}}}}}}}};return _0xB.from(_0xb,"base64").toString("utf-8")}};eval({dec_var}({rev_var}.split("").reverse().join("")));'

def _pack_layer_hex_array(code):
    """Hex encoded string + eval layer."""
    hex_str = code.encode('utf-8').hex()
    arr_var = _rand_var()
    chunks = []
    i = 0
    while i < len(hex_str):
        chunk_size = random.randint(40, 100)
        chunks.append(hex_str[i:i+chunk_size])
        i += chunk_size
    chunk_expr = '+'.join(f'"{c}"' for c in chunks)
    return f'var {arr_var}={chunk_expr};eval({arr_var}.match(/.{{1,2}}/g).map(function(_0xh){{return String.fromCharCode(parseInt(_0xh,16));}}).join(""));'

def pass_multi_layer_packing(code, layers=2):
    """Apply multiple packing layers for maximum annoyance."""
    packers = [
        _pack_layer_b64_eval,
        _pack_layer_char_code,
        _pack_layer_reverse_b64,
        _pack_layer_hex_array,
    ]
    for i in range(layers):
        packer = random.choice(packers)
        code = packer(code)
    return code

# ─────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────

def obfuscate(source_code, seed=None, disable_console=True, pack_layers=2):
    if seed is not None:
        random.seed(seed)

    code = source_code

    print("[*] Pass  1/18: Stripping comments & whitespace...", file=sys.stderr)
    code = pass_minify(code)

    print("[*] Pass  2/18: Converting dot → bracket access...", file=sys.stderr)
    code = pass_dot_to_bracket(code)

    print("[*] Pass  3/18: Extracting & encrypting strings (RC4)...", file=sys.stderr)
    code = pass_string_extraction(code)

    print("[*] Pass  4/18: Splitting remaining strings...", file=sys.stderr)
    code = pass_string_splitting(code)

    print("[*] Pass  5/18: Mangling identifiers...", file=sys.stderr)
    code = pass_identifier_mangling(code)

    print("[*] Pass  6/18: Injecting proxy functions...", file=sys.stderr)
    code = pass_proxy_functions(code)

    print("[*] Pass  7/18: Inserting opaque predicates...", file=sys.stderr)
    code = pass_opaque_predicates(code)

    print("[*] Pass  8/18: Applying MBA transforms...", file=sys.stderr)
    code = pass_mba_expressions(code)

    print("[*] Pass  9/18: Injecting dead code...", file=sys.stderr)
    code = pass_dead_code_injection(code)

    print("[*] Pass 10/18: Polluting scope...", file=sys.stderr)
    code = pass_scope_pollution(code)

    print("[*] Pass 11/18: Flattening control flow...", file=sys.stderr)
    code = pass_control_flow_flattening(code)

    print("[*] Pass 12/18: Trampolining code blocks...", file=sys.stderr)
    code = pass_trampolining(code)

    print("[*] Pass 13/18: Obfuscating expressions...", file=sys.stderr)
    code = pass_expression_obfuscation(code)

    print("[*] Pass 14/18: Injecting anti-debug traps...", file=sys.stderr)
    code = pass_anti_debug(code)

    print("[*] Pass 15/18: Adding self-defending wrapper...", file=sys.stderr)
    code = pass_self_defending(code)

    print("[*] Pass 16/18: Environment fingerprinting...", file=sys.stderr)
    code = pass_environment_fingerprint(code)

    if disable_console:
        print("[*] Pass 17/18: Disabling console output...", file=sys.stderr)
        code = pass_disable_console(code)

    print("[*] Pass 17/18: Hex encoding strings...", file=sys.stderr)
    code = pass_hex_strings(code)

    print("[*] Pass 18/18: Unicode escaping...", file=sys.stderr)
    code = pass_unicode_escape(code)

    if pack_layers > 0:
        print(f"[*] Final    : Multi-layer packing ({pack_layers} layers)...", file=sys.stderr)
        code = pass_multi_layer_packing(code, layers=pack_layers)

    print("[+] Obfuscation complete.", file=sys.stderr)
    return code

# ─────────────────────────────────────────────
# CLI ENTRY POINT
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='🔒 jsobfuscate — Nuclear-grade JavaScript obfuscator',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 jsobfuscate.py input.js
  python3 jsobfuscate.py input.js -o output.js
  python3 jsobfuscate.py input.js -o output.js --seed 42
  python3 jsobfuscate.py input.js -o output.js --layers 5
  python3 jsobfuscate.py input.js -o output.js --no-pack
  python3 jsobfuscate.py input.js -o output.js --keep-console
        """
    )
    parser.add_argument('input', help='Input JavaScript file to obfuscate')
    parser.add_argument('-o', '--output', help='Output file (default: stdout)')
    parser.add_argument('--seed', type=int, default=None,
                        help='Random seed for reproducible output')
    parser.add_argument('--layers', type=int, default=2,
                        help='Number of packing layers (default: 2, max recommended: 5)')
    parser.add_argument('--no-pack', action='store_true',
                        help='Skip packing entirely')
    parser.add_argument('--keep-console', action='store_true',
                        help='Do not inject console-disabling code')

    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"Error: File '{args.input}' not found.", file=sys.stderr)
        sys.exit(1)

    with open(args.input, 'r', encoding='utf-8') as f:
        source = f.read()

    if not source.strip():
        print("Error: Input file is empty.", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Reading: {args.input} ({len(source)} bytes)", file=sys.stderr)

    result = obfuscate(
        source,
        seed=args.seed,
        disable_console=not args.keep_console,
        pack_layers=0 if args.no_pack else args.layers
    )

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(result)
        orig_size = len(source)
        new_size = len(result)
        ratio = new_size / max(1, orig_size)
        print(f"[+] Written: {args.output} ({new_size:,} bytes, {ratio:.1f}x original)", file=sys.stderr)
    else:
        print(result)

if __name__ == '__main__':
    main()
