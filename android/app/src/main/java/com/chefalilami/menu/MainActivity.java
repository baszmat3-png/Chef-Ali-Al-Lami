package com.chefalilami.menu;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/** يعرض منيو المطعم داخل التطبيق، ويفتح واتساب والاتصال والخرائط في تطبيقاتها. */
public class MainActivity extends AppCompatActivity {
    private static final int BG = Color.parseColor("#0B0B0E"), GOLD = Color.parseColor("#E8C468");
    private WebView web;
    private LinearLayout overlay;
    private TextView overlayMsg;
    private Button retry;
    private ProgressBar bar;
    private String host;
    private boolean failed = false, loadedOnce = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        host = Uri.parse(BuildConfig.START_URL).getHost();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.getProgressDrawable().setColorFilter(GOLD, android.graphics.PorterDuff.Mode.SRC_IN);
        root.addView(bar, new FrameLayout.LayoutParams(-1, 8, Gravity.TOP));

        overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER);
        overlay.setBackgroundColor(BG);
        overlay.setPadding(48, 48, 48, 48);
        overlayMsg = new TextView(this);
        overlayMsg.setTextColor(Color.WHITE);
        overlayMsg.setTextSize(18);
        overlayMsg.setGravity(Gravity.CENTER);
        overlayMsg.setText("جارٍ التحميل…");
        overlay.addView(overlayMsg);
        retry = new Button(this);
        retry.setText("إعادة المحاولة");
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(v -> load());
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-2, -2);
        rp.topMargin = 32;
        overlay.addView(retry, rp);
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, w) -> {
            Insets i = w.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return handle(r.getUrl()); }
            @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap f) { failed = false; bar.setVisibility(View.VISIBLE); }
            @Override public void onPageFinished(WebView v, String url) {
                bar.setVisibility(View.GONE);
                if (!failed) { loadedOnce = true; overlay.setVisibility(View.GONE); }
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    failed = true;
                    overlayMsg.setText("تعذر الاتصال بالإنترنت\nتحقق من الاتصال ثم أعد المحاولة");
                    retry.setVisibility(View.VISIBLE);
                    overlay.setVisibility(View.VISIBLE);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) { bar.setProgress(p); }
            // window.open(...) من الصفحة (مثل رابط واتساب بعد إرسال الطلب) → نفتحه خارجياً
            @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean gesture, Message msg) {
                final WebView tmp = new WebView(MainActivity.this);
                tmp.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest r) { handle(r.getUrl()); w.destroy(); return true; }
                    @Override public void onPageStarted(WebView w, String url, android.graphics.Bitmap f) {
                        if (url != null && !url.equals("about:blank")) { handle(Uri.parse(url)); w.stopLoading(); w.destroy(); }
                    }
                });
                ((WebView.WebViewTransport) msg.obj).setWebView(tmp);
                msg.sendToTarget();
                return true;
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack(); else { setEnabled(false); getOnBackPressedDispatcher().onBackPressed(); }
            }
        });

        if (b != null) web.restoreState(b); else load();
    }

    private void load() {
        failed = false;
        retry.setVisibility(View.GONE);
        if (!loadedOnce) { overlayMsg.setText("جارٍ التحميل…"); overlay.setVisibility(View.VISIBLE); }
        web.loadUrl(BuildConfig.START_URL);
    }

    /** true = تم التعامل مع الرابط خارج التطبيق؛ false = يبقى داخل الصفحة */
    private boolean handle(Uri u) {
        String sch = u.getScheme() == null ? "" : u.getScheme(), h = u.getHost() == null ? "" : u.getHost();
        if ((sch.equals("https") || sch.equals("http")) && h.equals(host)) return false;
        if (sch.equals("about") || sch.equals("blob") || sch.equals("data") || sch.equals("javascript")) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException | SecurityException ignored) { }
        return true;
    }

    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
