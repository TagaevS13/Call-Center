"""
CRM Connector Engine: REST, SOAP (WSDL via zeep).
Конфиг и mapping хранятся в Postgres (crm_connectors).
"""
from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET
from typing import Any

import requests

try:
    from zeep import Client as ZeepClient
    from zeep.transports import Transport
except ImportError:
    ZeepClient = None  # type: ignore

# Поля карточки оператора (agent UI)
PROFILE_FIELDS = [
    "msisdn", "name", "tariff", "imsi", "pin1", "puk1", "pin2", "puk2",
    "core_balance", "balance", "category", "customer_code", "account_code",
    "icc", "group", "segment", "lang", "vip",
]

DEFAULT_MAPPING = {
    "msisdn": "msisdn",
    "name": "name",
    "tariff": "tariff",
    "balance": "balance",
    "category": "category",
    "segment": "segment",
}


def normalize_msisdn(raw: str) -> str:
    d = re.sub(r"\D", "", raw or "")
    if len(d) == 9 and d.startswith("9"):
        d = "992" + d
    return d


def msisdn_local(msisdn: str) -> str:
    """MDN для Boss4: без префикса 992 (как slice(3) в IVR)."""
    n = normalize_msisdn(msisdn)
    if n.startswith("992") and len(n) > 3:
        return n[3:]
    return n


def _local_tag(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def parse_boss4_param_list(xml_text: str) -> dict[str, str]:
    """Разбор ParamList из processBusiResponse."""
    root = ET.fromstring(xml_text)
    out: dict[str, str] = {}
    for elem in root.iter():
        if _local_tag(elem.tag) != "Param":
            continue
        name_val = None
        value_val = None
        for child in elem:
            lt = _local_tag(child.tag)
            if lt == "name" and child.text:
                name_val = child.text.strip()
            elif lt == "value":
                value_val = (child.text or "").strip()
        if name_val:
            out[name_val] = value_val or ""
    return out


def _lang_from_boss(code: str) -> str:
    return {"1": "en", "2": "ru", "3": "tg"}.get(str(code).strip(), "tg")


def boss4_build_envelope(mdn_local: str, operation_id: str = "10017") -> str:
    return f"""<?xml version='1.0' encoding='utf-8'?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
<SOAP-ENV:Body>
<ns1:processBusi xmlns:ns1="http://oss.huawei.com/webservice/unified/services">
<tns:Trade xmlns:tns="http://oss.huawei.com/webservice/unified/services">
<tns:System xmlns:tns="http://oss.huawei.com/webservice/unified/services">
<SN xmlns="http://oss.huawei.com/webservice/unified/services">CC</SN>
<messageType xmlns="http://oss.huawei.com/webservice/unified/services">Input</messageType>
<cmdCode xmlns="http://oss.huawei.com/webservice/unified/services">0</cmdCode>
</tns:System>
<tns:ParamList xmlns:tns="http://oss.huawei.com/webservice/unified/services">
<operationID xmlns="http://oss.huawei.com/webservice/unified/services">{operation_id}</operationID>
<tns:Param xmlns:tns="http://oss.huawei.com/webservice/unified/services">
<name xmlns="http://oss.huawei.com/webservice/unified/services">OperationType</name>
<value xmlns="http://oss.huawei.com/webservice/unified/services">0</value>
</tns:Param>
<tns:Param xmlns:tns="http://oss.huawei.com/webservice/unified/services">
<name xmlns="http://oss.huawei.com/webservice/unified/services">AccessMethod</name>
<value xmlns="http://oss.huawei.com/webservice/unified/services">1</value>
</tns:Param>
<tns:Param xmlns:tns="http://oss.huawei.com/webservice/unified/services">
<name xmlns="http://oss.huawei.com/webservice/unified/services">MDN</name>
<value xmlns="http://oss.huawei.com/webservice/unified/services">{mdn_local}</value>
</tns:Param>
</tns:ParamList>
</tns:Trade>
</ns1:processBusi>
</SOAP-ENV:Body>
</SOAP-ENV:Envelope>"""


def boss4_service_url(cfg: dict) -> str:
    url = cfg.get("service_url") or cfg.get("endpoint") or cfg.get("wsdl_url") or cfg.get("wsdl") or ""
    url = url.split("?")[0].rstrip("/")
    if not url:
        raise ValueError("Boss4: не задан service_url / wsdl_url")
    return url


def boss4_full_name(params: dict[str, str]) -> str:
    """ФИО: LastName + CustName + Middle_name (как в BSS)."""
    parts = [
        (params.get("LastName") or "").strip(),
        (params.get("CustName") or "").strip(),
        (params.get("Middle_name") or "").strip(),
    ]
    parts = [p for p in parts if p]
    if parts:
        return " ".join(parts)
    return (
        (params.get("CustomerName") or params.get("SubscriberName") or "").strip()
    )


def _split_csv_field(raw: str) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    return [x.strip() for x in str(raw).split(",")]


def boss4_parse_products(params: dict[str, str]) -> list[dict]:
    """SPProdNames / SPProdIds / SPStatus → Product List в Agent UI."""
    names = _split_csv_field(params.get("SPProdNames") or "")
    ids = _split_csv_field(params.get("SPProdIds") or "")
    statuses = _split_csv_field(params.get("SPStatus") or "")
    eff_dates = _split_csv_field(params.get("SPEffDate") or "")
    exp_dates = _split_csv_field(params.get("SPExpDate") or "")
    n = max(len(names), len(ids), len(statuses), 1) if (names or ids) else 0
    out: list[dict] = []
    for i in range(n):
        name = names[i] if i < len(names) else ""
        pid = ids[i] if i < len(ids) else ""
        if not name and not pid:
            continue
        st = (statuses[i] if i < len(statuses) else "").strip()
        st_low = st.lower()
        active = st_low in ("active", "a") or st_low.startswith("active")
        out.append({
            "name": name or pid,
            "product_id": pid,
            "active": active,
            "since": (eff_dates[i] if i < len(eff_dates) else "") or "—",
            "fee": (exp_dates[i] if i < len(exp_dates) else "") or "—",
            "status": st or "—",
        })
    return out


def uvs_service_url(cfg: dict) -> str:
    uvs = cfg.get("uvs") if isinstance(cfg.get("uvs"), dict) else {}
    url = (
        uvs.get("service_url")
        or cfg.get("uvs_url")
        or cfg.get("uvs_service_url")
        or "http://172.16.1.63:7782/services/UVSInterface_Extend"
    )
    url = str(url).replace("//services", "/services").split("?")[0].rstrip("/")
    return url


def uvs_build_account_query(mdn_local: str, cfg: dict) -> str:
    uvs = cfg.get("uvs") if isinstance(cfg.get("uvs"), dict) else {}
    user_id = uvs.get("user_id") or cfg.get("uvs_user_id") or "root"
    password = uvs.get("password") or cfg.get("uvs_password") or "root"
    seq_id = str(uvs.get("sequence_id") or "109678625")
    remote = uvs.get("remote_addr") or "127.0.0.1"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:win="http://bme.huawei.com/winuvsinterface">
<soapenv:Header/>
<soapenv:Body>
<win:AccountQuery>
<win:AccountQueryRequest>
<win:RequestMessage>
<win:MessageHeader>
<win:CommandId>AccountQueryRequest</win:CommandId>
<win:Version>1</win:Version>
<win:TransactionId>1</win:TransactionId>
<win:SequenceId>{seq_id}</win:SequenceId>
<win:RequestType>Event</win:RequestType>
</win:MessageHeader>
<win:MessageBody>
<win:SubscriberID>{mdn_local}</win:SubscriberID>
<win:IncludeLP>1</win:IncludeLP>
<win:SubNo>{mdn_local}</win:SubNo>
<win:IncludeInitBal>1</win:IncludeInitBal>
<win:AcctBalanceId></win:AcctBalanceId>
</win:MessageBody>
</win:RequestMessage>
</win:AccountQueryRequest>
<win:SessionEntity>
<win:userID>{user_id}</win:userID>
<win:password>{password}</win:password>
<win:remoteAddr>{remote}</win:remoteAddr>
<win:uploadRoot>root</win:uploadRoot>
<win:locale>en</win:locale>
<win:loginVia>true</win:loginVia>
</win:SessionEntity>
</win:AccountQuery>
</soapenv:Body>
</soapenv:Envelope>"""


def _uvs_int_value(parent: ET.Element) -> int | None:
    for child in parent:
        if _local_tag(child.tag) == "Value" and child.text is not None:
            try:
                return int(child.text.strip())
            except ValueError:
                return None
    return None


def parse_uvs_account_query(xml_text: str) -> dict[str, Any]:
    """
    AccountQuery → AccountRecordList.
    AccountType 3000: денежный баланс (Value / 10000).
    5001/5005/5002/5050/4500: пакеты мин/SMS/GPRS.
    """
    root = ET.fromstring(xml_text)
    out: dict[str, Any] = {
        "balance": None,
        "core_balance": None,
        "remain_min": 0,
        "amount_min": 0,
        "remain_sms": 0,
        "amount_sms": 0,
        "remain_gprs_mb": 0.0,
        "amount_gprs_mb": 0.0,
        "accounts": [],
    }
    for rec in root.iter():
        if _local_tag(rec.tag) != "AccountRecord":
            continue
        atype = None
        bal_val = None
        init_val = None
        for el in rec:
            lt = _local_tag(el.tag)
            if lt == "AccountType" and el.text:
                atype = el.text.strip()
            elif lt == "Balance":
                bal_val = _uvs_int_value(el)
            elif lt in ("InitalBalance", "InitialBalance"):
                init_val = _uvs_int_value(el)
        if not atype:
            continue
        entry = {"account_type": atype, "balance": bal_val, "initial": init_val}
        out["accounts"].append(entry)
        if atype == "3000" and bal_val is not None:
            out["balance"] = f"{bal_val / 10000:.2f}"
            if init_val is not None:
                out["core_balance"] = f"{init_val / 10000:.2f}"
        elif atype == "5001":
            out["remain_min"] += bal_val or 0
            out["amount_min"] += init_val or 0
        elif atype == "5005":
            out["remain_min"] += (bal_val or 0) // 60
            out["amount_min"] += (init_val or 0) // 60
        elif atype in ("5002", "5050"):
            out["remain_sms"] += bal_val or 0
            out["amount_sms"] += init_val or 0
        elif atype == "4500":
            out["remain_gprs_mb"] += (bal_val or 0) / 1024 / 1024
            out["amount_gprs_mb"] += (init_val or 0) / 1024 / 1024
    if out["remain_gprs_mb"]:
        out["remain_gprs_mb"] = round(out["remain_gprs_mb"], 2)
        out["amount_gprs_mb"] = round(out["amount_gprs_mb"], 2)
    return out


def uvs_enabled(cfg: dict) -> bool:
    if cfg.get("uvs_enabled") is False:
        return False
    uvs = cfg.get("uvs")
    if isinstance(uvs, dict) and uvs.get("enabled") is False:
        return False
    return bool(
        cfg.get("uvs_url")
        or cfg.get("uvs_service_url")
        or (isinstance(uvs, dict) and uvs.get("service_url"))
        or _is_boss4(cfg)
    )


def uvs_account_lookup(msisdn: str, cfg: dict) -> dict[str, Any]:
    mdn = msisdn_local(msisdn)
    url = uvs_service_url(cfg)
    body = uvs_build_account_query(mdn, cfg)
    timeout = int(cfg.get("uvs_timeout") or cfg.get("timeout") or 30)
    headers = {"Content-Type": "text/xml; charset=UTF-8"}
    r = requests.post(url, data=body.encode("utf-8"), headers=headers, timeout=timeout)
    r.raise_for_status()
    parsed = parse_uvs_account_query(r.text)
    parsed["uvs_raw_xml"] = r.text[:8000] if len(r.text) > 8000 else r.text
    return parsed


def boss4_enrich_profile(profile: dict, params: dict[str, str], cfg: dict | None = None) -> dict:
    if profile.get("lang") and str(profile["lang"]).isdigit():
        profile["lang"] = _lang_from_boss(profile["lang"])
    elif params.get("SubLanguage"):
        profile["lang"] = _lang_from_boss(params["SubLanguage"])

    mdn = params.get("MDN") or ""
    if mdn:
        profile["msisdn"] = normalize_msisdn(mdn)
    if not profile.get("name"):
        profile["name"] = boss4_full_name(params)
    if not profile.get("tariff"):
        profile["tariff"] = params.get("RatePlanName") or ""
    if not profile.get("icc"):
        profile["icc"] = params.get("ICCID") or ""
    if not profile.get("customer_code"):
        profile["customer_code"] = params.get("SubID") or ""
    if not profile.get("account_code"):
        profile["account_code"] = params.get("SubID") or ""
    if not profile.get("category"):
        profile["category"] = params.get("RatingCategory") or params.get("Status") or ""
    if not profile.get("segment"):
        profile["segment"] = params.get("CustSegment") or params.get("CustLevel") or ""

    profile["rate_plan_id"] = params.get("RatePlanId") or ""
    profile["change_date"] = params.get("ChangeDate") or ""
    profile["home_address"] = params.get("HomeAddress") or ""
    profile["products"] = boss4_parse_products(params)

    if cfg and uvs_enabled(cfg):
        try:
            uvs = uvs_account_lookup(profile.get("msisdn") or params.get("MDN") or "", cfg)
            if uvs.get("balance"):
                profile["balance"] = uvs["balance"]
            if uvs.get("core_balance"):
                profile["core_balance"] = uvs["core_balance"]
            elif uvs.get("balance") and not profile.get("core_balance"):
                profile["core_balance"] = uvs["balance"]
            profile["uvs_packages"] = {
                "remain_min": uvs.get("remain_min"),
                "amount_min": uvs.get("amount_min"),
                "remain_sms": uvs.get("remain_sms"),
                "amount_sms": uvs.get("amount_sms"),
                "remain_gprs_mb": uvs.get("remain_gprs_mb"),
                "amount_gprs_mb": uvs.get("amount_gprs_mb"),
            }
            profile["uvs_accounts"] = uvs.get("accounts")
        except Exception as exc:
            profile["uvs_error"] = str(exc)

    return profile


def boss4_lookup(msisdn: str, connector: dict) -> dict:
    cfg = _merge_config(connector)
    mdn = msisdn_local(msisdn)
    op_id = str(cfg.get("operation_id") or "10017")
    url = boss4_service_url(cfg)
    body = boss4_build_envelope(mdn, op_id)
    timeout = int(cfg.get("timeout") or 30)
    headers = {"Content-Type": "text/xml; charset=UTF-8"}
    r = requests.post(url, data=body.encode("utf-8"), headers=headers, timeout=timeout)
    r.raise_for_status()
    params = parse_boss4_param_list(r.text)
    if not params:
        raise ValueError("Boss4: пустой ParamList в ответе")
    profile = apply_mapping(params, connector.get("field_mapping") or {})
    boss4_enrich_profile(profile, params, cfg)
    profile["source"] = "boss4"
    profile["crm_connector"] = connector.get("name")
    profile["crm_raw"] = params
    return profile


def _get_path(obj: Any, path: str) -> Any:
    if not path:
        return None
    cur = obj
    for part in path.replace("/", ".").split("."):
        if part == "":
            continue
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return cur


def _render_template(tpl: str, ctx: dict) -> str:
    def repl(m):
        key = m.group(1).strip()
        val = _get_path(ctx, key)
        return "" if val is None else str(val)

    return re.sub(r"\{\{([^}]+)\}\}", repl, tpl or "")


def apply_mapping(data: Any, mapping: dict) -> dict:
    mapping = mapping or DEFAULT_MAPPING
    out = {"source": "crm"}
    for field, path in mapping.items():
        if not path:
            continue
        val = _get_path(data, path)
        if val is not None and val != "":
            out[field] = val
    return out


def _merge_config(connector: dict) -> dict:
    cfg = dict(connector.get("config") or {})
    secrets = cfg.get("secrets") or {}
    if isinstance(secrets, str):
        try:
            secrets = json.loads(secrets)
        except json.JSONDecodeError:
            secrets = {}
    cfg["_secrets"] = secrets
    return cfg


def rest_lookup(msisdn: str, connector: dict) -> dict:
    cfg = _merge_config(connector)
    method = (cfg.get("method") or "GET").upper()
    url_tpl = cfg.get("url") or cfg.get("endpoint") or ""
    if not url_tpl:
        raise ValueError("REST: не задан url")
    ctx = {"msisdn": normalize_msisdn(msisdn), "secrets": cfg.get("_secrets", {})}
    url = _render_template(url_tpl, ctx)
    headers = {}
    for k, v in (cfg.get("headers") or {}).items():
        headers[k] = _render_template(str(v), ctx)
    timeout = int(cfg.get("timeout") or 15)
    auth = cfg.get("auth") or {}
    auth_type = auth.get("type") or "none"
    req_kw = {"timeout": timeout, "headers": headers}
    if auth_type == "basic":
        req_kw["auth"] = (auth.get("username") or "", auth.get("password") or "")
    elif auth_type == "bearer":
        token = auth.get("token") or cfg.get("_secrets", {}).get("token") or ""
        headers["Authorization"] = f"Bearer {token}"
    elif auth_type == "api_key":
        hk = auth.get("header") or "X-API-Key"
        headers[hk] = auth.get("key") or cfg.get("_secrets", {}).get("api_key") or ""

    body = cfg.get("body")
    if method == "GET":
        r = requests.request(method, url, **req_kw)
    else:
        if isinstance(body, dict):
            body = json.loads(_render_template(json.dumps(body), ctx))
        elif isinstance(body, str):
            body = _render_template(body, ctx)
        req_kw["json"] = body if isinstance(body, dict) else None
        req_kw["data"] = body if isinstance(body, str) else None
        r = requests.request(method, url, **req_kw)
    r.raise_for_status()
    try:
        payload = r.json()
    except Exception:
        payload = {"raw": r.text}
    root = cfg.get("response_root")
    if root:
        payload = _get_path(payload, root) or payload
    profile = apply_mapping(payload, connector.get("field_mapping") or {})
    if not profile.get("msisdn"):
        profile["msisdn"] = normalize_msisdn(msisdn)
    profile["crm_connector"] = connector.get("name")
    profile["crm_raw"] = payload
    return profile


def _is_boss4(cfg: dict) -> bool:
    if cfg.get("soap_style") == "boss4" or cfg.get("boss4"):
        return True
    if str(cfg.get("operation_id") or "") == "10017":
        return True
    wsdl = (cfg.get("wsdl_url") or cfg.get("wsdl") or "").lower()
    return "boss4unifiedinterfaceservice" in wsdl


def soap_lookup(msisdn: str, connector: dict) -> dict:
    cfg = _merge_config(connector)
    if _is_boss4(cfg):
        return boss4_lookup(msisdn, connector)
    if ZeepClient is None:
        raise RuntimeError("SOAP: установите zeep (pip install zeep)")
    wsdl = cfg.get("wsdl_url") or cfg.get("wsdl") or cfg.get("endpoint")
    if not wsdl:
        raise ValueError("SOAP: не задан wsdl_url")
    operation = cfg.get("operation") or cfg.get("method")
    if not operation:
        raise ValueError("SOAP: не задан operation")
    ctx = {"msisdn": normalize_msisdn(msisdn), "secrets": cfg.get("_secrets", {})}
    timeout = int(cfg.get("timeout") or 30)
    session = requests.Session()
    auth = cfg.get("auth") or {}
    if auth.get("type") == "basic":
        session.auth = (auth.get("username") or "", auth.get("password") or "")
    transport = Transport(session=session, timeout=timeout)
    client = ZeepClient(wsdl, transport=transport)
    op = getattr(client.service, operation, None)
    if op is None:
        raise ValueError(f"SOAP: операция {operation} не найдена в WSDL")
    params_tpl = cfg.get("parameters") or {"msisdn": "{{msisdn}}"}
    params = {}
    for k, v in params_tpl.items():
        params[k] = _render_template(str(v), ctx) if isinstance(v, str) else v
    result = op(**params)
    if hasattr(result, "__dict__"):
        from zeep.helpers import serialize_object
        payload = serialize_object(result)
    elif isinstance(result, dict):
        payload = result
    else:
        payload = {"value": result}
    root = cfg.get("response_root")
    if root:
        payload = _get_path(payload, root) or payload
    profile = apply_mapping(payload, connector.get("field_mapping") or {})
    if not profile.get("msisdn"):
        profile["msisdn"] = normalize_msisdn(msisdn)
    profile["crm_connector"] = connector.get("name")
    profile["crm_raw"] = payload
    return profile


def lookup_subscriber(msisdn: str, connector: dict) -> dict:
    ctype = (connector.get("connector_type") or connector.get("type") or "rest").lower()
    if ctype == "soap":
        return soap_lookup(msisdn, connector)
    return rest_lookup(msisdn, connector)


def builtin_mock_profile(msisdn: str) -> dict:
    """Fallback когда внешний CRM недоступен — минимальная карточка без выдуманных PIN."""
    n = normalize_msisdn(msisdn)
    return {
        "source": "builtin",
        "msisdn": n,
        "name": f"Абонент {n}",
        "segment": "unknown",
        "category": "Физическое лицо",
        "balance": "—",
        "tariff": "—",
    }
