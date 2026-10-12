using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;

namespace ThreeSM.EnduranceConnector
{
    // Eigen design-system (dark + oranje accent): tokens en herbruikbare componenten.
    // Originele implementatie in dezelfde visuele taal als de referentie-UI.
    public static class UiKit
    {
        // ---- tokens ----
        public static readonly SolidColorBrush Bg = B("#0E0F13");
        public static readonly SolidColorBrush Surface = B("#16181F");
        public static readonly SolidColorBrush SurfaceAlt = B("#1C1F29");
        public static readonly SolidColorBrush SurfaceHi = B("#232734");
        public static readonly SolidColorBrush Border = B("#2A2E3C");
        public static readonly SolidColorBrush Text = B("#F2F4F8");
        public static readonly SolidColorBrush Muted = B("#97A0B5");
        public static readonly SolidColorBrush Accent = B("#FF6B1A");
        public static readonly SolidColorBrush AccentSoft = B("#FFA169");
        public static readonly SolidColorBrush AccentTint = B("#3A2113");
        public static readonly SolidColorBrush Ok = B("#3DD68C");
        public static readonly SolidColorBrush Warn = B("#FFC24B");
        public static readonly SolidColorBrush Danger = B("#FF5C6C");

        public static SolidColorBrush B(string hex) { return new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex)); }
        public static Thickness T(double all) { return new Thickness(all); }
        public static Thickness T(double h, double v) { return new Thickness(h, v, h, v); }
        public static Thickness T(double left, double top, double right, double bottom) { return new Thickness(left, top, right, bottom); }

        private const string XamlNs = "xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\" ";

        // ---- tekst ----
        public static TextBlock Title(string text) { return new TextBlock { Text = text, FontSize = 22, FontWeight = FontWeights.Bold, Foreground = Text }; }
        public static TextBlock Sub(string text) { return new TextBlock { Text = text, FontSize = 12.5, Foreground = Muted, TextWrapping = TextWrapping.Wrap }; }
        public static TextBlock Section(string text) { return new TextBlock { Text = text, FontSize = 14.5, FontWeight = FontWeights.Bold, Foreground = Text }; }
        public static TextBlock Label(string text) { return new TextBlock { Text = text, Foreground = Muted, FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.WrapWithOverflow }; }
        public static TextBlock Caption(string text) { return new TextBlock { Text = text, FontSize = 11.5, Foreground = AccentSoft, TextWrapping = TextWrapping.Wrap }; }
        public static TextBlock Eyebrow(string text) { return new TextBlock { Text = (text ?? string.Empty).ToUpperInvariant(), FontSize = 11, FontWeight = FontWeights.Bold, Foreground = AccentSoft }; }

        public static Border Header(string title, string subtitle)
        {
            var stack = new StackPanel { Margin = T(0, 0, 0, 16) };
            stack.Children.Add(Title(title));
            if (!string.IsNullOrEmpty(subtitle)) { var s = Sub(subtitle); s.Margin = T(0, 4, 0, 0); stack.Children.Add(s); }
            return new Border { Child = stack };
        }

        // ---- card met sectiekop + oranje lijn ----
        public static Border Card(UIElement content, string eyebrow = null)
        {
            var stack = new StackPanel();
            if (!string.IsNullOrEmpty(eyebrow))
            {
                var header = new StackPanel { Margin = T(0, 0, 0, 12) };
                header.Children.Add(Section(eyebrow));
                header.Children.Add(new Border { Height = 2, Background = Accent, Opacity = 0.7, CornerRadius = new CornerRadius(1), Margin = T(0, 6, 0, 0) });
                stack.Children.Add(header);
            }
            stack.Children.Add(content);
            return new Border { Background = Surface, BorderBrush = Border, BorderThickness = T(1), CornerRadius = new CornerRadius(10), Padding = T(16), Margin = T(0, 0, 0, 12), Child = stack };
        }

        // ---- buttons ----
        private static ControlTemplate ButtonTemplate(string bg, string fg, string hover, string border)
        {
            var borderExtra = border == null ? string.Empty : " BorderBrush=\"" + border + "\" BorderThickness=\"1\"";
            var xaml =
                "<ControlTemplate " + XamlNs + "TargetType=\"Button\">" +
                "<Border x:Name=\"b\" CornerRadius=\"8\" Background=\"" + bg + "\"" + borderExtra + " Padding=\"14,8\">" +
                "<ContentPresenter HorizontalAlignment=\"Center\" VerticalAlignment=\"Center\"/>" +
                "</Border>" +
                "<ControlTemplate.Triggers>" +
                "<Trigger Property=\"IsMouseOver\" Value=\"True\"><Setter TargetName=\"b\" Property=\"Background\" Value=\"" + hover + "\"/></Trigger>" +
                "<Trigger Property=\"IsEnabled\" Value=\"False\"><Setter TargetName=\"b\" Property=\"Opacity\" Value=\"0.45\"/></Trigger>" +
                "</ControlTemplate.Triggers>" +
                "</ControlTemplate>";
            return (ControlTemplate)XamlReader.Parse(xaml);
        }

        public static Button Primary(string text)
        {
            return new Button { Content = text, Template = ButtonTemplate("#FF6B1A", "#FFFFFF", "#FF8138", null), FontWeight = FontWeights.SemiBold, Cursor = Cursors.Hand, Foreground = Brushes.White, Margin = T(0, 0, 8, 8) };
        }

        public static Button Secondary(string text)
        {
            return new Button { Content = text, Template = ButtonTemplate("#1C1F29", "#F2F4F8", "#262B3A", "#2A2E3C"), Cursor = Cursors.Hand, Foreground = Text, Margin = T(0, 0, 8, 8) };
        }

        public static Button DangerButton(string text)
        {
            return new Button { Content = text, Template = ButtonTemplate("#2A1518", "#FF8A96", "#3A1B20", "#5A2A30"), Cursor = Cursors.Hand, Foreground = Danger, Margin = T(0, 0, 8, 8) };
        }

        // ---- schakelaar (pil) ----
        private static ControlTemplate SwitchTemplate()
        {
            const string xaml =
                "<ControlTemplate " + XamlNs + "TargetType=\"ToggleButton\">" +
                "<Border x:Name=\"track\" Width=\"46\" Height=\"24\" CornerRadius=\"12\" Background=\"#232734\" BorderBrush=\"#3A3F52\" BorderThickness=\"1\">" +
                "<Grid><Ellipse x:Name=\"knob\" Width=\"18\" Height=\"18\" Fill=\"#97A0B5\" HorizontalAlignment=\"Left\" Margin=\"3,0,0,0\"/></Grid>" +
                "</Border>" +
                "<ControlTemplate.Triggers>" +
                "<Trigger Property=\"IsChecked\" Value=\"True\">" +
                "<Setter TargetName=\"track\" Property=\"Background\" Value=\"#FF6B1A\"/>" +
                "<Setter TargetName=\"track\" Property=\"BorderBrush\" Value=\"#FF6B1A\"/>" +
                "<Setter TargetName=\"knob\" Property=\"Fill\" Value=\"#FFFFFF\"/>" +
                "<Setter TargetName=\"knob\" Property=\"HorizontalAlignment\" Value=\"Right\"/>" +
                "<Setter TargetName=\"knob\" Property=\"Margin\" Value=\"0,0,3,0\"/>" +
                "</Trigger>" +
                "<Trigger Property=\"IsMouseOver\" Value=\"True\"><Setter TargetName=\"track\" Property=\"BorderBrush\" Value=\"#FFA169\"/></Trigger>" +
                "<Trigger Property=\"IsEnabled\" Value=\"False\"><Setter Property=\"Opacity\" Value=\"0.4\"/><Setter Property=\"Cursor\" Value=\"Arrow\"/></Trigger>" +
                "</ControlTemplate.Triggers>" +
                "</ControlTemplate>";
            return (ControlTemplate)XamlReader.Parse(xaml);
        }

        // Let op: dezelfde signatuur als voorheen, zodat alle aanroepen blijven werken.
        public static UIElement Toggle(string label, bool initial, Action<bool> onChange)
        {
            var panel = new StackPanel { Orientation = Orientation.Horizontal, Margin = T(0, 0, 18, 10) };
            var box = new ToggleButton { Template = SwitchTemplate(), IsChecked = initial, Cursor = Cursors.Hand, VerticalAlignment = VerticalAlignment.Center };
            box.Checked += delegate { if (onChange != null) onChange(true); };
            box.Unchecked += delegate { if (onChange != null) onChange(false); };
            panel.Children.Add(box);
            if (!string.IsNullOrEmpty(label))
                panel.Children.Add(new TextBlock { Text = label, Foreground = Text, FontSize = 12.5, Margin = T(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.WrapWithOverflow });
            return panel;
        }

        // ---- slider met waarde ----
        private static Style ThumbStyle()
        {
            const string xaml =
                "<Style " + XamlNs + "TargetType=\"Thumb\">" +
                "<Setter Property=\"Width\" Value=\"14\"/><Setter Property=\"Height\" Value=\"14\"/>" +
                "<Setter Property=\"Template\"><Setter.Value>" +
                "<ControlTemplate TargetType=\"Thumb\"><Ellipse Fill=\"#FF6B1A\" Width=\"14\" Height=\"14\"/></ControlTemplate>" +
                "</Setter.Value></Setter></Style>";
            return (Style)XamlReader.Parse(xaml);
        }

        public static Grid SliderRow(string label, double value, double min, double max, Action<int> set, string suffix = "", double width = 190, UIElement preview = null)
        {
            var grid = new Grid { Margin = T(0, 2, 0, 8) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(170) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(58) });
            if (preview == null) grid.Children.Add(Label(label));
            else
            {
                // Het label blijft in de vaste labelkolom; het previewtje krijgt een eigen
                // kolom rechts, zodat het nooit klemt tussen label en slider.
                grid.Children.Add(Label(label));
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var host = new Border
                {
                    Child = preview,
                    Margin = T(12, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    HorizontalAlignment = HorizontalAlignment.Left,
                };
                Grid.SetColumn(host, 3);
                grid.Children.Add(host);
            }

            var slider = new Slider
            {
                Minimum = min,
                Maximum = max,
                Value = Math.Max(min, Math.Min(max, value)),
                Width = width,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = T(0),
            };
            try { slider.Resources.Add(typeof(Thumb), ThumbStyle()); } catch { }
            Grid.SetColumn(slider, 1);
            grid.Children.Add(slider);

            var valueText = new TextBlock { Text = ((int)Math.Round(value)) + suffix, Foreground = Text, FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right };
            Grid.SetColumn(valueText, 2);
            grid.Children.Add(valueText);

            slider.ValueChanged += delegate
            {
                var v = (int)Math.Round(slider.Value);
                valueText.Text = v + suffix;
                if (set != null) set(v);
            };
            return grid;
        }

        // ---- segmented keuze (chips) ----
        private static ControlTemplate ChipTemplate()
        {
            const string xaml =
                "<ControlTemplate " + XamlNs + "TargetType=\"RadioButton\">" +
                "<Border x:Name=\"chip\" CornerRadius=\"8\" Background=\"#1C1F29\" BorderBrush=\"#2A2E3C\" BorderThickness=\"1\" Padding=\"12,7\">" +
                "<ContentPresenter HorizontalAlignment=\"Center\" VerticalAlignment=\"Center\"/></Border>" +
                "<ControlTemplate.Triggers>" +
                "<Trigger Property=\"IsMouseOver\" Value=\"True\"><Setter TargetName=\"chip\" Property=\"BorderBrush\" Value=\"#FFA169\"/></Trigger>" +
                "<Trigger Property=\"IsChecked\" Value=\"True\"><Setter TargetName=\"chip\" Property=\"Background\" Value=\"#3A2113\"/><Setter TargetName=\"chip\" Property=\"BorderBrush\" Value=\"#FF6B1A\"/></Trigger>" +
                "</ControlTemplate.Triggers>" +
                "</ControlTemplate>";
            return (ControlTemplate)XamlReader.Parse(xaml);
        }

        public static Grid Segmented(string[] options, int selectedIndex, Action<int> onSelect)
        {
            var grid = new Grid { Margin = T(0, 2, 0, 8) };
            if (options == null) return grid;
            var group = "seg" + Guid.NewGuid().ToString("N");
            for (var i = 0; i < options.Length; i++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (var i = 0; i < options.Length; i++)
            {
                var idx = i;
                var chip = new RadioButton
                {
                    Content = options[i], GroupName = group, Template = ChipTemplate(),
                    Foreground = Text, FontSize = 12, FontWeight = FontWeights.SemiBold, Cursor = Cursors.Hand,
                    Margin = T(0, 0, 8, 0), HorizontalContentAlignment = HorizontalAlignment.Center,
                    IsChecked = i == selectedIndex,
                };
                chip.Checked += delegate { if (onSelect != null) onSelect(idx); };
                Grid.SetColumn(chip, i);
                grid.Children.Add(chip);
            }
            return grid;
        }

        // ---- iconen met ronde tooltip ----
        public static ToolTip Tip(string text)
        {
            var tip = new ToolTip { Content = new TextBlock { Text = text, Foreground = Text, TextWrapping = TextWrapping.Wrap, MaxWidth = 380 } };
            const string xaml =
                "<ControlTemplate " + XamlNs + "TargetType=\"ToolTip\">" +
                "<Border MaxWidth=\"420\" Padding=\"12\" Background=\"#0B0B10\" BorderBrush=\"#3A3F52\" BorderThickness=\"1\" CornerRadius=\"8\"><ContentPresenter/></Border>" +
                "</ControlTemplate>";
            try { tip.Template = (ControlTemplate)XamlReader.Parse(xaml); } catch { }
            return tip;
        }

        public static UIElement Hint(string text)
        {
            var circle = new Border
            {
                Width = 16, Height = 16, CornerRadius = new CornerRadius(8), Background = SurfaceHi,
                BorderBrush = Border, BorderThickness = T(1), Margin = T(8, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center, Cursor = Cursors.Help, ToolTip = Tip(text),
            };
            circle.Child = new TextBlock { Text = "?", FontSize = 10, FontWeight = FontWeights.Bold, Foreground = Muted, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            return circle;
        }

        public static UIElement WarnIcon(string text)
        {
            return new TextBlock { Text = "⚠", FontSize = 14, Foreground = Warn, Margin = T(8, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, Cursor = Cursors.Help, ToolTip = Tip(text) };
        }

        // Rij met label + controle + optionele hint/warn.
        public static Grid RowControl(string label, UIElement control, string hint = null, string warn = null)
        {
            var grid = new Grid { Margin = T(0, 4, 0, 10) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(170) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var text = Label(label);
            grid.Children.Add(text);
            Grid.SetColumn(control, 1);
            grid.Children.Add(control);
            var icons = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = T(0, 0, 0, 0) };
            if (!string.IsNullOrEmpty(hint)) icons.Children.Add(Hint(hint));
            if (!string.IsNullOrEmpty(warn)) icons.Children.Add(WarnIcon(warn));
            if (icons.Children.Count > 0) { Grid.SetColumn(icons, 2); grid.Children.Add(icons); }
            return grid;
        }

        // ---- mini LED-paneeltje (voor inline previews) ----
        public static Border MiniPanel(string[] colours, int columns, int rows, int cell = 7, double margin = 0)
        {
            var grid = new UniformGrid { Rows = rows, Columns = columns, Width = columns * cell, Height = rows * cell, Background = Bg };
            const int max = 1200; // veiligheidsgrens
            for (var i = 0; i < columns * rows && i < max; i++)
            {
                var colour = colours != null && i < colours.Length ? colours[i] : "#000000";
                Brush fill;
                try { fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString(string.IsNullOrEmpty(colour) ? "#000000" : colour)); }
                catch { fill = Brushes.Black; }
                grid.Children.Add(new Rectangle { Fill = fill, Margin = T(0.5) });
            }
            return new Border { Background = Bg, BorderBrush = Border, BorderThickness = T(1), CornerRadius = new CornerRadius(4), Padding = T(2), Margin = T(0, 0, margin, 0), HorizontalAlignment = HorizontalAlignment.Left, Child = grid };
        }

        // ---- invoer ----
        public static TextBox Field(double width = 220)
        {
            return new TextBox { Width = width, Padding = T(10, 7), Background = Bg, Foreground = Text, BorderBrush = Border, BorderThickness = T(1), HorizontalAlignment = HorizontalAlignment.Left, CaretBrush = Text };
        }

        public static ComboBox Combo(bool editable = false, double width = 220)
        {
            var combo = new ComboBox
            {
                IsEditable = editable,
                Width = width,
                HorizontalAlignment = HorizontalAlignment.Left,
                Background = SurfaceAlt,
                Foreground = Text,
                BorderBrush = Border,
                BorderThickness = T(1),
                MaxDropDownHeight = 320,
            };
            try { combo.Template = ComboTemplate(); } catch { }
            try { combo.ItemContainerStyle = ComboItemStyle(); } catch { }
            return combo;
        }

        private static ControlTemplate _comboTemplate;
        private static Style _comboItemStyle;

        // Let op: een eigen ComboBox-template moet de dropdown zelf bevatten —
        // een ToggleButton die IsDropDownOpen zet plus een Popup (PART_Popup) met
        // ItemsPresenter. Zonder die twee klapt er niets open.
        private static ControlTemplate ComboTemplate()
        {
            if (_comboTemplate != null) return _comboTemplate;
            const string xaml =
                "<ControlTemplate " + XamlNs + "TargetType=\"ComboBox\">" +
                "<Grid>" +
                "<Border x:Name=\"bd\" Background=\"#1C1F29\" BorderBrush=\"#2A2E3C\" BorderThickness=\"1\" CornerRadius=\"8\">" +
                "<Grid><Grid.ColumnDefinitions><ColumnDefinition Width=\"*\"/><ColumnDefinition Width=\"26\"/></Grid.ColumnDefinitions>" +
                "<ContentPresenter x:Name=\"content\" Grid.Column=\"0\" Margin=\"10,7\" VerticalAlignment=\"Center\"" +
                " Content=\"{TemplateBinding SelectionBoxItem}\" ContentTemplate=\"{TemplateBinding SelectionBoxItemTemplate}\"" +
                " ContentTemplateSelector=\"{TemplateBinding ItemTemplateSelector}\" ContentStringFormat=\"{TemplateBinding SelectionBoxItemStringFormat}\"/>" +
                "<Path x:Name=\"arrow\" Grid.Column=\"1\" HorizontalAlignment=\"Center\" VerticalAlignment=\"Center\" Data=\"M 0 0 L 8 0 L 4 5 Z\" Fill=\"#97A0B5\"/>" +
                "</Grid></Border>" +
                // volledige overlay: klik waar dan ook op de combo opent de lijst
                "<ToggleButton x:Name=\"toggle\" Focusable=\"False\" ClickMode=\"Press\"" +
                " IsChecked=\"{Binding IsDropDownOpen, Mode=TwoWay, RelativeSource={RelativeSource TemplatedParent}}\">" +
                "<ToggleButton.Template><ControlTemplate TargetType=\"ToggleButton\">" +
                "<Border Background=\"Transparent\" CornerRadius=\"8\"/>" +
                "</ControlTemplate></ToggleButton.Template></ToggleButton>" +
                // bij een bewerkbare combo staat het tekstvak bovenop de overlay
                "<TextBox x:Name=\"PART_EditableTextBox\" Visibility=\"Collapsed\" Margin=\"8,4,28,4\" Padding=\"0\"" +
                " Background=\"Transparent\" BorderThickness=\"0\" Foreground=\"#F2F4F8\" CaretBrush=\"#F2F4F8\"" +
                " VerticalContentAlignment=\"Center\" IsReadOnly=\"{TemplateBinding IsReadOnly}\"/>" +
                "<Popup x:Name=\"PART_Popup\" AllowsTransparency=\"True\" Placement=\"Bottom\" PopupAnimation=\"Fade\" Focusable=\"False\"" +
                " IsOpen=\"{TemplateBinding IsDropDownOpen}\">" +
                "<Border Background=\"#1C1F29\" BorderBrush=\"#2A2E3C\" BorderThickness=\"1\" CornerRadius=\"8\" Margin=\"0,4,0,0\"" +
                " MinWidth=\"{TemplateBinding ActualWidth}\" MaxHeight=\"{TemplateBinding MaxDropDownHeight}\">" +
                "<ScrollViewer VerticalScrollBarVisibility=\"Auto\" HorizontalScrollBarVisibility=\"Disabled\" Focusable=\"False\">" +
                "<ItemsPresenter/>" +
                "</ScrollViewer></Border></Popup>" +
                "</Grid>" +
                "<ControlTemplate.Triggers>" +
                "<Trigger Property=\"IsEditable\" Value=\"True\">" +
                "<Setter TargetName=\"content\" Property=\"Visibility\" Value=\"Collapsed\"/>" +
                "<Setter TargetName=\"PART_EditableTextBox\" Property=\"Visibility\" Value=\"Visible\"/>" +
                "</Trigger>" +
                "<Trigger Property=\"IsMouseOver\" Value=\"True\"><Setter TargetName=\"bd\" Property=\"BorderBrush\" Value=\"#FFA169\"/></Trigger>" +
                "<Trigger Property=\"IsDropDownOpen\" Value=\"True\"><Setter TargetName=\"bd\" Property=\"BorderBrush\" Value=\"#FFA169\"/></Trigger>" +
                "<Trigger Property=\"IsEnabled\" Value=\"False\"><Setter Property=\"Opacity\" Value=\"0.45\"/></Trigger>" +
                "</ControlTemplate.Triggers>" +
                "</ControlTemplate>";
            _comboTemplate = (ControlTemplate)XamlReader.Parse(xaml);
            return _comboTemplate;
        }

        // Lijst-items in dezelfde donkere stijl (anders kleuren ze licht/donkerblauw).
        private static Style ComboItemStyle()
        {
            if (_comboItemStyle != null) return _comboItemStyle;
            const string xaml =
                "<Style " + XamlNs + "TargetType=\"ComboBoxItem\">" +
                "<Setter Property=\"Foreground\" Value=\"#F2F4F8\"/>" +
                "<Setter Property=\"Padding\" Value=\"10,7\"/>" +
                "<Setter Property=\"Template\"><Setter.Value>" +
                "<ControlTemplate TargetType=\"ComboBoxItem\">" +
                "<Border x:Name=\"ib\" Background=\"Transparent\" CornerRadius=\"6\" Margin=\"2\" Padding=\"{TemplateBinding Padding}\">" +
                "<ContentPresenter/>" +
                "</Border>" +
                "<ControlTemplate.Triggers>" +
                "<Trigger Property=\"IsHighlighted\" Value=\"True\"><Setter TargetName=\"ib\" Property=\"Background\" Value=\"#232734\"/></Trigger>" +
                "<Trigger Property=\"IsSelected\" Value=\"True\">" +
                "<Setter TargetName=\"ib\" Property=\"Background\" Value=\"#3A2113\"/>" +
                "<Setter Property=\"Foreground\" Value=\"#FFA169\"/>" +
                "</Trigger>" +
                "</ControlTemplate.Triggers>" +
                "</ControlTemplate>" +
                "</Setter.Value></Setter>" +
                "</Style>";
            _comboItemStyle = (Style)XamlReader.Parse(xaml);
            return _comboItemStyle;
        }

        public static Grid Row(string label, UIElement control) { return RowControl(label, control); }

        public static Grid InfoRow(string label, string value)
        {
            var grid = new Grid { Margin = T(0, 3, 0, 3) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(170) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var l = Label(label);
            var v = new TextBlock { Text = value, Foreground = Text, FontSize = 12.5, TextWrapping = TextWrapping.Wrap };
            Grid.SetColumn(l, 0); Grid.SetColumn(v, 1);
            grid.Children.Add(l); grid.Children.Add(v);
            return grid;
        }

        public static Border Badge(string text, Brush colour)
        {
            return new Border
            {
                Background = colour, CornerRadius = new CornerRadius(10), Padding = T(10, 4), HorizontalAlignment = HorizontalAlignment.Left,
                Child = new TextBlock { Text = text, Foreground = B("#0E0F13"), FontSize = 11.5, FontWeight = FontWeights.Bold },
            };
        }

        // ---- navigatie ----
        public static ControlTemplate NavTemplate()
        {
            var xaml =
                "<ControlTemplate " + XamlNs + "TargetType=\"RadioButton\">" +
                "<Grid>" +
                "<Border x:Name=\"bg\" CornerRadius=\"8\" Background=\"Transparent\" Padding=\"12,10\"><ContentPresenter VerticalAlignment=\"Center\"/></Border>" +
                "<Rectangle x:Name=\"bar\" Width=\"3\" HorizontalAlignment=\"Left\" Fill=\"#FF6B1A\" RadiusX=\"1.5\" RadiusY=\"1.5\" Opacity=\"0\"/>" +
                "</Grid>" +
                "<ControlTemplate.Triggers>" +
                "<Trigger Property=\"IsMouseOver\" Value=\"True\"><Setter TargetName=\"bg\" Property=\"Background\" Value=\"#1C1F29\"/></Trigger>" +
                "<Trigger Property=\"IsChecked\" Value=\"True\"><Setter TargetName=\"bg\" Property=\"Background\" Value=\"#232734\"/><Setter TargetName=\"bar\" Property=\"Opacity\" Value=\"1\"/><Setter Property=\"Foreground\" Value=\"#F2F4F8\"/></Trigger>" +
                "</ControlTemplate.Triggers>" +
                "</ControlTemplate>";
            return (ControlTemplate)XamlReader.Parse(xaml);
        }

        public static RadioButton NavItem(string icon, string label, bool selected, Action onClick)
        {
            var rb = new RadioButton
            {
                GroupName = "nav",
                Content = icon + "    " + label,
                IsChecked = selected,
                Foreground = Muted,
                FontSize = 13,
                Margin = T(0, 2, 0, 2),
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Cursor = Cursors.Hand,
                Template = NavTemplate(),
            };
            rb.Checked += delegate { if (onClick != null) onClick(); };
            return rb;
        }

        // ---- animaties ----
        public static void AnimateIn(UIElement element, double fromY = 8, double ms = 220)
        {
            if (element == null) return;
            element.Opacity = 0;
            var translate = new TranslateTransform(0, fromY);
            element.RenderTransform = translate;
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            var fade = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(ms)) { EasingFunction = ease };
            var slide = new DoubleAnimation(fromY, 0, TimeSpan.FromMilliseconds(ms)) { EasingFunction = ease };
            element.BeginAnimation(UIElement.OpacityProperty, fade);
            translate.BeginAnimation(TranslateTransform.YProperty, slide);
        }

        public static Expander Section2(string title, UIElement content)
        {
            return new Expander
            {
                Header = new TextBlock { Text = title, Foreground = Text, FontSize = 13, FontWeight = FontWeights.SemiBold },
                Content = new Border { Child = content, Margin = T(4, 8, 0, 0) },
                Foreground = Text,
                Margin = T(0, 2, 0, 6),
                IsExpanded = false,
            };
        }

        public static Expander Section(string title, UIElement content) { return Section2(title, content); }
    }
}
