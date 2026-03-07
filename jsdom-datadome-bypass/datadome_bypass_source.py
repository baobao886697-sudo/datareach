# Source: https://github.com/ellisfan/bypass-datadome/blob/main/datadome.py
# This shows how to generate DataDome cookies WITHOUT a browser
# by faking the tags.js payload and sending it to api-js.datadome.co/js/

import random
import time
import base64

from browserforge.fingerprints import Screen, FingerprintGenerator

class DataDome:
    def __init__(self, ddv="4.25.0", ddk="your datadome key"):
        self.__ddv = ddv
        self.__ddk = ddk
        self.__screen = Screen(
            min_width=1280, max_width=5120, min_height=720, max_height=2880
        )
        self.__headers = FingerprintGenerator(
            browser=("chrome", "firefox", "safari", "edge"),
            os=("windows", "macos"),
            device="desktop",
            locale=("zh-CN", "en"),
            screen=self.__screen,
            http_version=2,
            strict=True,
            mock_webrtc=True,
        )
        self.__temps = self.__headers.generate()

    def build(self, url):
        stcfp = f"""ps://js.datadome.co/tags.js?id={self.__ddk}:2:90854)
    at https://js.datadome.co/tags.js?id={self.__ddk}:2:53225"""
        return {
            "headers": {
                "Content-type": "application/x-www-form-urlencoded",
                "Host": "api-js.datadome.co",
                "Origin": url,
                "Referer": url,
                "Accept-Encoding": self.__temps.headers.get("Accept-Encoding"),
                "Accept-Language": self.__temps.headers.get("Accept-Language"),
                "Sec-Ch-Ua": self.__temps.headers.get("sec-ch-ua"),
                "Sec-Ch-Ua-Mobile": self.__temps.headers.get("sec-ch-ua-mobile"),
                "Sec-Ch-Ua-Platform": self.__temps.headers.get("sec-ch-ua-platform"),
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "User-Agent": self.__temps.headers.get("User-Agent"),
                "Upgrade-Insecure-Requests": self.__temps.headers.get("Upgrade-Insecure-Requests"),
            },
            "payload": {
                "ddv": self.__ddv,
                "eventCounters": [],
                "jsType": "ch",
                "ddk": self.__ddk,
                "request": "%2F",
                "responsePage": "origin",
                "cid": "null",
                "Referer": url,
                "jsData": {
                    "ttst": f"{random.randint(10, 99)}.{random.randint(1000000000000, 9000000000000)}",
                    "ifov": "false",
                    "hc": self.__temps.navigator.hardwareConcurrency,
                    # ... 100+ fields of browser fingerprint data
                    # Including screen, codecs, WebGL, canvas, timezone, etc.
                    "jset": int(time.time()),
                },
            },
        }
