#!/usr/bin/env python3
"""
Camoufox DataDome Interstitial Solver

Uses Camoufox (anti-detect Firefox based on Playwright) to solve
DataDome interstitial challenges and extract valid datadome cookies.

Architecture:
  - Camoufox provides a real browser environment with anti-fingerprint patches
  - Residential proxy ensures clean IP reputation
  - The solver navigates to the target URL, waits for the interstitial to solve,
    and extracts the resulting datadome cookie
  - Cookie can then be used with curl_cffi for fast, concurrent data scraping

Key Findings:
  - The DataDome cookie is IP-bound. It must be used from the same proxy session.
  - TruePeopleSearch has changed its search endpoint from /resultname to /results
    with `Name` and `CityStateZip` parameters.
  - TPS has a second layer of protection (InternalCaptcha) that Camoufox gets
    redirected to, but curl_cffi with the DataDome cookie bypasses it.

Dependencies:
  pip: camoufox curl_cffi
"""
import json
import logging
import random
import re
import time
from typing import Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class SolverResult:
    """Result of a DataDome interstitial solve attempt"""
    success: bool
    cookie: Optional[str] = None
    cookie_value: Optional[str] = None
    error: Optional[str] = None
    elapsed: float = 0.0
    challenge_type: Optional[str] = None  # 'i' = interstitial, 'c' = captcha
    proxy_session_id: Optional[str] = None


class CamoufoxDataDomeSolver:
    """
    Solves DataDome interstitial challenges using Camoufox.
    
    Usage:
        solver = CamoufoxDataDomeSolver(
            proxy_user=
            proxy_pass_base=
        )
        result = solver.solve(
            target_url=
            search_params={
                "Name": "john smith",
                "CityStateZip": "new york",
            }
        )
        if result.success:
            print(f"Cookie: {result.cookie_value}")
            # Use result.cookie_value and result.proxy_session_id for scraping
    """
    
    def __init__(
        self,
        proxy_user: str,
        proxy_pass_base: str,
        proxy_host: str = 'core-residential.evomi.com',
        proxy_port: int = 1000,
        proxy_country: str = 'US',
        headless: bool = True,
        timeout_ms: int = 30000,
        max_wait_seconds: int = 20,
    ):
        self.proxy_user = proxy_user
        self.proxy_pass_base = proxy_pass_base
        self.proxy_host = proxy_host
        self.proxy_port = proxy_port
        self.proxy_country = proxy_country
        self.headless = headless
        self.timeout_ms = timeout_ms
        self.max_wait_seconds = max_wait_seconds
    
    def _make_proxy_config(self, session_id: Optional[str] = None) -> Tuple[dict, str]:
        """Create proxy configuration for Camoufox"""
        sid = session_id or str(random.randint(1000000, 9999999))
        pwd = f'{self.proxy_pass_base}_country-{self.proxy_country}_session-{sid}'
        return {
            'server': f'http://{self.proxy_host}:{self.proxy_port}',
            'username': self.proxy_user,
            'password': pwd,
        }, sid
    
    def solve(
        self,
        target_url: str,
        search_params: dict,
        session_id: Optional[str] = None,
        max_retries: int = 3,
    ) -> SolverResult:
        """
        Solve DataDome interstitial for the given target URL.
        
        Args:
            target_url: The base URL of the site (e.g., https://www.truepeoplesearch.com)
            search_params: Dictionary of search parameters (e.g., {"Name": "john smith"})
            session_id: Optional proxy session ID for IP persistence
            max_retries: Maximum number of retry attempts with different IPs
        
        Returns:
            SolverResult with success status and cookie if solved
        """
        for attempt in range(max_retries):
            proxy_config, sid = self._make_proxy_config(session_id)
            
            logger.info(f"Solve attempt {attempt + 1}/{max_retries} (session: {sid})")
            
            try:
                result = self._solve_single(target_url, search_params, proxy_config, sid)
                
                if result.success:
                    return result
                
                if result.challenge_type == 'c':
                    logger.warning(f"Got captcha (bot detected), retrying with new IP...")
                    session_id = None  # Force new IP
                    continue
                
                if result.error:
                    logger.warning(f"Attempt {attempt + 1} failed: {result.error}")
                    session_id = None
                    continue
                    
            except Exception as e:
                logger.error(f"Attempt {attempt + 1} exception: {e}")
                session_id = None
                continue
        
        return SolverResult(
            success=False,
            error=f"Failed after {max_retries} attempts"
        )
    
    def _solve_single(
        self,
        target_url: str,
        search_params: dict,
        proxy_config: dict,
        session_id: str,
    ) -> SolverResult:
        """Single solve attempt using Camoufox"""
        from camoufox.sync_api import Camoufox
        from urllib.parse import urlencode
        
        start_time = time.time()
        challenge_results = []
        
        # Construct search URL
        if 'truepeoplesearch.com' in target_url:
            search_url = f"https://www.truepeoplesearch.com/results?{urlencode(search_params)}"
        else:
            search_url = f"{target_url}?{urlencode(search_params)}"
        
        try:
            with Camoufox(
                headless=self.headless,
                proxy=proxy_config,
            ) as browser:
                page = browser.new_page()
                
                def on_response(response):
                    url = response.url
                    if 'captcha-delivery.com' in url and 'interstitial' in url and response.request.method == 'POST':
                        try:
                            data = response.json()
                            challenge_results.append(data)
                            logger.debug(f"POST result: view={data.get('view', '')}")
                        except Exception:
                            pass
                
                page.on('response', on_response)
                
                try:
                    page.goto(search_url, wait_until='load', timeout=self.timeout_ms)
                except Exception as e:
                    logger.debug(f"Navigation event: {type(e).__name__}")
                
                # Wait for interstitial to solve
                for _ in range(self.max_wait_seconds):
                    if challenge_results and challenge_results[-1].get('view') == 'redirect':
                        break
                    time.sleep(1)
                
                # Extract cookie from browser context
                cookie_value = self._extract_cookie(browser)
                
                if cookie_value:
                    return SolverResult(
                        success=True,
                        cookie_value=cookie_value,
                        cookie=f"datadome={cookie_value}",
                        proxy_session_id=session_id,
                        elapsed=time.time() - start_time,
                    )
                
                # Check challenge type if no cookie found
                content = page.content()
                dd_match = re.search(r"var dd=(\{[^}]+\})", content)
                if dd_match:
                    dd_obj = json.loads(dd_match.group(1).replace("'"))
                    if dd_obj.get('rt') == 'c':
                        return SolverResult(success=False, challenge_type='c', error="Got captcha")
                
                return SolverResult(
                    success=False,
                    error="Timeout - no cookie found after interstitial",
                    elapsed=time.time() - start_time,
                )
                
        except Exception as e:
            return SolverResult(
                success=False,
                error=str(e),
                elapsed=time.time() - start_time,
            )
    
    def _extract_cookie(self, browser) -> Optional[str]:
        """Extract datadome cookie from browser context"""
        try:
            cookies = browser.contexts[0].cookies()
            for c in cookies:
                if c['name'] == 'datadome':
                    return c['value']
        except Exception:
            pass
        return None


def main():
    """CLI test of the Camoufox solver and curl_cffi scraper"""
    import sys
    from curl_cffi import requests as cffi_requests
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(message)s'
    )
    
    # --- Step 1: Solve DataDome with Camoufox ---
    print(f"{'='*60}\nStep 1: Solve DataDome with Camoufox\n{'='*60}")
    
    solver = CamoufoxDataDomeSolver(
        proxy_user='baobao88667',
        proxy_pass_base='ib3itu0y152BDW0Scg1m',
    )
    
    solve_result = solver.solve(
        target_url='https://www.truepeoplesearch.com',
        search_params={
            'Name': 'john smith',
            'CityStateZip': 'new york',
        }
    )
    
    print(f"\nSolver Result:")
    print(f"  Success: {solve_result.success}")
    print(f"  Elapsed: {solve_result.elapsed:.1f}s")
    
    if not solve_result.success:
        print(f"  Error: {solve_result.error}")
        sys.exit(1)
    
    print(f"  Cookie: {solve_result.cookie_value[:50]}...")
    print(f"  Proxy session: {solve_result.proxy_session_id}")
    
    # --- Step 2: Scrape with curl_cffi using the cookie ---
    print(f"\n{'='*60}\nStep 2: Scrape with curl_cffi\n{'='*60}")
    
    # Rebuild proxy URL with the same session ID
    pwd = f"ib3itu0y152BDW0Scg1m_country-US_session-{solve_result.proxy_session_id}"
    proxy_url = f"http://baobao88667:{pwd}@core-residential.evomi.com:1000"
    proxies = {'http': proxy_url, 'https': proxy_url}
    
    session = cffi_requests.Session(impersonate='chrome131')
    
    search_url = f"https://www.truepeoplesearch.com/results?{urlencode({'Name': 'john smith', 'CityStateZip': 'new york'})}"
    
    resp = session.get(search_url, headers={
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': f'datadome={solve_result.cookie_value}',
        'Referer': 'https://www.truepeoplesearch.com/',
    }, proxies=proxies, timeout=15, allow_redirects=True)
    
    print(f"  Status: {resp.status_code} | Size: {len(resp.text)}")
    print(f"  URL: {resp.url[:80]}")
    
    if 'data-detail-link' in resp.text:
        links = re.findall(r'data-detail-link="([^"]+)"', resp.text)
        print(f"  SUCCESS! Got {len(links)} results with curl_cffi!")
    elif 'InternalCaptcha' in resp.url:
        print(f"  Redirected to InternalCaptcha (TPS's own captcha)")
    else:
        print(f"  Scraping failed.")


if __name__ == '__main__':
    from urllib.parse import urlencode
    main()
