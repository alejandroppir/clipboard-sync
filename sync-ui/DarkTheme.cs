using System.Runtime.InteropServices;

namespace SyncApp;

/// <summary>
/// Applies a consistent dark theme with the app accent color (#2cb232) to any WinForms Form.
/// Call Apply(this) at the end of each Form constructor (after all controls are added).
/// </summary>
internal static class DarkTheme
{
    internal static readonly Color Background = Color.FromArgb(0x1e, 0x1e, 0x1e);
    internal static readonly Color Surface    = Color.FromArgb(0x2d, 0x2d, 0x2d);
    internal static readonly Color Text       = Color.FromArgb(0xd4, 0xd4, 0xd4);
    internal static readonly Color ButtonBg   = Color.FromArgb(0x3c, 0x3c, 0x3c);
    internal static readonly Color Border     = Color.FromArgb(0x55, 0x55, 0x55);
    internal static readonly Color Accent     = ColorTranslator.FromHtml("#2cb232");

    // DWMWA_USE_IMMERSIVE_DARK_MODE = 20 (Win11); attribute 19 works on Win10 2004+
    private const int DwmwaDarkMode    = 20;
    private const int DwmwaDarkModeLeg = 19;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int pvAttr, int cbAttr);

    /// <summary>Darkens title bar and styles all child controls recursively.</summary>
    internal static void Apply(Form form)
    {
        _ = form.Handle; // force HWND creation before DWM call
        int dark = 1;
        if (DwmSetWindowAttribute(form.Handle, DwmwaDarkMode, ref dark, 4) != 0)
            DwmSetWindowAttribute(form.Handle, DwmwaDarkModeLeg, ref dark, 4);

        form.BackColor = Background;
        form.ForeColor = Text;
        StyleControls(form.Controls);
    }

    /// <summary>Styles a ContextMenuStrip (not in Controls tree).</summary>
    internal static void StyleMenu(ContextMenuStrip menu)
    {
        menu.BackColor  = Surface;
        menu.ForeColor  = Text;
        foreach (ToolStripItem item in menu.Items)
        {
            item.BackColor = Surface;
            item.ForeColor = Text;
        }
    }

    private static void StyleControls(Control.ControlCollection controls)
    {
        foreach (Control c in controls)
        {
            switch (c)
            {
                case TextBox tb:
                    tb.BackColor    = Surface;
                    tb.ForeColor    = Text;
                    tb.BorderStyle  = BorderStyle.FixedSingle;
                    break;

                case Button btn:
                    // Only restyle buttons that haven't been given a custom (accent) color
                    if (btn.BackColor == SystemColors.Control)
                    {
                        btn.FlatStyle = FlatStyle.Flat;
                        btn.BackColor = ButtonBg;
                        btn.ForeColor = Text;
                        btn.FlatAppearance.BorderColor = Border;
                        btn.FlatAppearance.BorderSize  = 1;
                    }
                    break;

                case Label lbl:
                    lbl.BackColor = Color.Transparent; // show parent bg
                    if (lbl.ForeColor == SystemColors.ControlText)
                        lbl.ForeColor = Text;
                    break;

                case TableLayoutPanel tlp:
                    tlp.BackColor = Background;
                    break;

                case FlowLayoutPanel flp:
                    flp.BackColor = Surface;
                    break;

                case Panel p:
                    p.BackColor = Background;
                    break;
            }

            if (c.Controls.Count > 0)
                StyleControls(c.Controls);
        }
    }
}
