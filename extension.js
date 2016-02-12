// Switcher is a Gnome Shell extension allowing quickly switching windows by
// typing
// Copyright (C) 2015  Daniel Landau
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/*global imports, print */
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Meta = imports.gi.Meta;
const GLib = imports.gi.GLib;

const ExtensionUtils = imports.misc.extensionUtils;
const Convenience = ExtensionUtils.getCurrentExtension().imports.convenience;

const keyActivationNone = 0;
const keyActivationFunctionKeys = 1;
const keyActivationNumbers = 2;

let container, cursor;

const functionKeySymbols = [
  Clutter.KEY_F1,
  Clutter.KEY_F2,
  Clutter.KEY_F3,
  Clutter.KEY_F4,
  Clutter.KEY_F5,
  Clutter.KEY_F6,
  Clutter.KEY_F7,
  Clutter.KEY_F8,
  Clutter.KEY_F9,
  Clutter.KEY_F10,
  Clutter.KEY_F11,
  Clutter.KEY_F12
];
const numberKeySymbols = [
  Clutter.KEY_1,
  Clutter.KEY_2,
  Clutter.KEY_3,
  Clutter.KEY_4,
  Clutter.KEY_5,
  Clutter.KEY_6,
  Clutter.KEY_7,
  Clutter.KEY_8,
  Clutter.KEY_9,
  Clutter.KEY_0,
];

function makeFilter(text) {
  return function(app) {
    return text.split(' ').every(fragment =>
        description(app).toLowerCase().indexOf(fragment.toLowerCase()) !== -1);
  };
}

function _hideUI() {
  Main.uiGroup.remove_actor(container);
  Main.popModal(container);
  container = null;
}

function makeBox(app, index) {
  const iconSize = Convenience.getSettings().get_uint('icon-size');

  const box = new St.BoxLayout({style_class : 'switcher-box'});

  let shortcutBox = undefined;
  if (getActionKeyTable().length > 0) {
    const shortcut = new St.Label(
        {style_class : 'switcher-shortcut', text : getKeyDesc(index + 1)});
    shortcutBox = new St.Bin({style_class : 'switcher-label'});
    shortcutBox.child = shortcut;
    box.insert_child_at_index(shortcutBox, 0);
  }
  const classLabel = new St.Label({
    style_class : 'switcher-label',
    y_align : Clutter.ActorAlign.CENTER,
    x_align : Clutter.ActorAlign.START,
    x_expand : true,
    text : getClass(app)
  });
  let classBox = new St.BoxLayout({pack_start : true});
  classBox.add(classLabel);
  const titleLabel = new St.Label({
    style_class : 'switcher-label',
    y_align : Clutter.ActorAlign.CENTER,
    x_expand : true,
    text : app.get_title()
  });
  const iconBox = new St.Bin({style_class : 'switcher-icon'});
  box.insert_child_at_index(titleLabel, 0);
  box.insert_child_at_index(classBox, 0);
  const appRef = Shell.WindowTracker.get_default().get_window_app(app);
  iconBox.child = appRef.create_icon_texture(iconSize);
  box.insert_child_at_index(iconBox, 0);

  return {whole : box, classBox : classBox, shortcutBox : shortcutBox};
}

function getClass(app) {
  const appRef = Shell.WindowTracker.get_default().get_window_app(app);
  let appName;
  try {
    appName = appRef.get_name();
  } catch (e) {
    print(e);
    appName = 'Could not get name';
  }
  return appName;
}

function description(app) { return getClass(app) + ' ' + app.get_title(); }

function updateHighlight(boxes) {
  boxes.forEach(box => box.whole.remove_style_class_name('switcher-highlight'));
  boxes.length > cursor &&
      boxes[cursor].whole.add_style_class_name('switcher-highlight');
}

function _showUI() {
  'use strict';
  if (container)
    return;

  let filteredApps;

  const debouncedActivateUnique = debounce(() => {
    if (filteredApps.length === 1) {
      _hideUI();
      Main.activateWindow(filteredApps[cursor]);
    }
  }, Convenience.getSettings().get_uint('activate-after-ms'));

  cursor = 0;

  container = new St.Bin({reactive : true});
  container.set_alignment(St.Align.MIDDLE, St.Align.START);

  const fontSize = Convenience.getSettings().get_uint('font-size');
  let boxLayout = new St.BoxLayout({style_class : 'switcher-box-layout'});
  boxLayout.set_style('font-size: ' + fontSize + 'px');
  boxLayout.set_vertical(true);

  // Get all windows in activation order
  const apps = global.display.get_tab_list(Meta.TabList.NORMAL, null);

  // swap the first two, so we can switch quickly back and forth
  if (apps.length >= 2) {
    const tmp = apps[0];
    apps[0] = apps[1];
    apps[1] = tmp;
  }

  filteredApps = apps;

  // Compute name width from length, adjusted with font size. Set a reasonable
  // limit for this width, keeping an acceptable whitespace.
  const maxWidth = Main.layoutManager.primaryMonitor.width * 0.01 *
                   Convenience.getSettings().get_uint('max-width-percentage');
  let classBoxSize = 0;
  let length = filteredApps.length;
  for (let i = 0; i < length; i++) {
    classBoxSize = Math.max(getClass(filteredApps[i]).length, classBoxSize);
  }
  const fontFactor = fontSize * 0.675;
  classBoxSize *= fontFactor;
  classBoxSize = Math.min(classBoxSize, maxWidth * (fontFactor * 0.015));

  let boxes = filteredApps.map(makeBox);
  updateHighlight(boxes);
  const entry =
      new St.Entry({style_class : 'switcher-entry', hint_text : 'type filter'});
  boxLayout.insert_child_at_index(entry, 0);
  boxes.forEach((box) => boxLayout.insert_child_at_index(box.whole, -1));

  container.add_actor(boxLayout);
  Main.uiGroup.add_actor(container);

  let monitor = Main.layoutManager.primaryMonitor;
  container.set_width(monitor.width);
  container.set_height(monitor.height);
  container.set_position(monitor.x, monitor.y);

  let width =
      boxes.map(box => box.whole.width).reduce((a, b) => Math.max(a, b), 0);
  let shortcutWidth =
      boxes.map(box => box.shortcutBox ? box.shortcutBox.width : 0)
           .reduce((a, b) => Math.max(a, b), 0);
  if (width > maxWidth)
    width = maxWidth;
  boxes.forEach(box => fixWidths(classBoxSize, box, width, shortcutWidth));

  entry.set_width(width);

  entry.connect('key-release-event', (o, e) => {
    const symbol = e.get_key_symbol();
    let fkeyIndex = getActionKeyTable().indexOf(symbol);
    if (symbol === Clutter.KEY_Escape)
      _hideUI();
    else if (symbol === Clutter.KEY_Return) {
      _hideUI();
      filteredApps.length > 0 && Main.activateWindow(filteredApps[cursor]);
    } else if (symbol === Clutter.KEY_Down) {
      cursor = cursor + 1 < boxes.length ? cursor + 1 : cursor;
      updateHighlight(boxes);
    } else if (symbol === Clutter.KEY_Up) {
      cursor = cursor > 0 ? cursor - 1 : cursor;
      updateHighlight(boxes);
    } else if (fkeyIndex >= 0 && fkeyIndex < filteredApps.length) {
      _hideUI();
      Main.activateWindow(filteredApps[fkeyIndex]);
    } else {
      boxes.forEach(box => boxLayout.remove_child(box.whole));
      filteredApps = apps.filter(makeFilter(o.text));
      if (Convenience.getSettings().get_boolean('activate-immediately') &&
          filteredApps.length === 1) {
        debouncedActivateUnique();
      }

      boxes = filteredApps.map(makeBox);
      updateHighlight(boxes);
      boxes.forEach((box) => {
        fixWidths(classBoxSize, box, width, shortcutWidth);
        boxLayout.insert_child_at_index(box.whole, -1);
      });
    }
  });

  Main.pushModal(container);
  container.connect('button-press-event', _hideUI);
  global.stage.set_key_focus(entry);
  container.show();
}

function fixWidths(classBoxSize, box, width, shortcutWidth) {
  box.whole.set_width(width);
  box.classBox.set_width(classBoxSize);
  box.shortcutBox && box.shortcutBox.set_width(shortcutWidth);
}

function getActivateByKey() {
  return Convenience.getSettings().get_uint('activate-by-key');
}

function getKeyDesc(index) {
  switch (getActivateByKey()) {
  case keyActivationFunctionKeys:
    return index > 12 ? '' : 'F' + index;
  case keyActivationNumbers:
    return index > 10 ? '' : index.toString();
  default:
    print("getKeyDesc error: " + index);
    return '';
  }
}

function getActionKeyTable() {
  switch (getActivateByKey()) {
  case keyActivationFunctionKeys:
    return functionKeySymbols;
  case keyActivationNumbers:
    return numberKeySymbols;
  default:
    return [];
  }
}

function init() {}

function enable() {
  Main.wm.addKeybinding(
      'show-switcher', Convenience.getSettings(), Meta.KeyBindingFlags.NONE,
      // Since Gnome 3.16, Shell.KeyBindingMode is replaced by Shell.ActionMode
      Shell.KeyBindingMode ? Shell.KeyBindingMode.NORMAL
                           : Shell.ActionMode.NORMAL,
      _showUI);
}

function disable() { Main.wm.removeKeybinding('show-switcher'); }

// from https://github.com/satya164/gjs-helpers
const setTimeout = (f, ms) => {
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    f();

    return false; // Don't repeat
  }, null);
};

const clearTimeout = id => GLib.Source.remove(id);

function debounce(f, ms) {
  let timeoutId = null;
  return function() {
    if (timeoutId)
      clearTimeout(timeoutId);
    timeoutId = setTimeout(f, ms);
  };
}

