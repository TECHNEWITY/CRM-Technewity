import { useEffect, useState } from 'react'
import { RichTextEditorProps, TextareaProps } from '../type'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Underline from '@tiptap/extension-underline'
import Image from '@tiptap/extension-image'

import { RiImageAddFill } from 'react-icons/ri'
import { Extension } from '@tiptap/core'
// import { keymap } from '@tiptap/pm/keymap'
// import { baseKeymap } from '@tiptap/pm/commands'

import './style.css'
import { Text } from '@tiptap/extension-text'
import Button from '../../Button'
import {
  AiOutlineBold,
  AiOutlineItalic,
  AiOutlineUnderline
} from 'react-icons/ai'
import { IoImageOutline } from 'react-icons/io5'
import { HiSparkles } from 'react-icons/hi2'

const DisableEscape = Extension.create({
  addKeyboardShortcuts() {
    return {
      Escape: () => true
    }
  }
})

// const KeyEventHandler = Extension.create({
//   name: 'KeyEventHandler',
//
//   addProseMirrorPlugins() {
//     return [
//       keymap(baseKeymap),
//       keymap({
//         'Shift-a': () => {
//           console.log('Shift-a pressed')
//           return true
//         }
//       })
//     ]
//   }
// })

export default function RichTextEditor({
  title,
  value,
  helper,
  error,
  required,
  disabled,
  readOnly,
  extensions = [],
  enableRephrase = true,
  onRephrase,
  onCtrlEnter,
  onCtrlEsc,
  onBlur
}: RichTextEditorProps) {
  const [isRephrasing, setIsRephrasing] = useState(false)
  const classes = ['form-control']

  disabled && classes.push('disabled')
  required && classes.push('required')
  readOnly && classes.push('readonly')
  error && classes.push('error')

  const editor = useEditor({
    onBlur: () => {
      onBlur && onBlur()
    },
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Bold,
      Italic,
      Underline,
      Image,
      ...extensions,
      DisableEscape,
      // KeyEventHandler,
      Text.extend({
        addKeyboardShortcuts() {
          return {
            Enter: () => {
              const html = this.editor.getHTML()
              html && onCtrlEnter && onCtrlEnter(html)
              this.editor.commands.clearContent()
              return true
            },
            'Control-Escape': () => {
              console.log('Control-escape pressed')
              onCtrlEsc && onCtrlEsc()
              return true
            }
          }
        }
      })
    ],
    editable: !readOnly,
    content: value
  })

  useEffect(() => {
    value &&
      editor?.commands.setContent(value, false, { preserveWhitespace: 'full' })
  }, [value, editor])

  useEffect(() => {
    editor?.setEditable(!readOnly, true)
  }, [readOnly, editor])

  if (!editor) {
    return null
  }

  const handleRephrase = async () => {
    const currentText = editor.getText()
    if (!currentText || !currentText.trim()) return
    if (!onRephrase) return
    try {
      setIsRephrasing(true)
      const rephrased = await onRephrase(currentText)
      if (rephrased) {
        editor.commands.setContent(rephrased)
      }
    } catch (err) {
      console.error('Rephrase error:', err)
    } finally {
      setIsRephrasing(false)
    }
  }

  const marks = () => {
    return (
      <div className="flex gap-2 pt-3 items-center">
        <Button
          size="sm"
          className={`mark ${editor.isActive('bold') ? 'mark-active' : ''}`}
          onClick={() => {
            editor.chain().focus().toggleBold().run()
          }}
          leadingIcon={<AiOutlineBold />}
        />

        <Button
          size="sm"
          className={`mark ${editor.isActive('italic') ? 'mark-active' : ''}`}
          onClick={() => {
            editor.chain().focus().toggleItalic().run()
          }}
          leadingIcon={<AiOutlineItalic />}
        />

        <Button
          size="sm"
          className={`mark ${editor.isActive('underline') ? 'mark-active' : ''
            }`}
          onClick={() => {
            editor.chain().focus().toggleUnderline().run()
          }}
          leadingIcon={<AiOutlineUnderline />}
        />

        <Button
          size="sm"
          onClick={() => {
            const url = window.prompt('URL')

            if (url) {
              editor.chain().focus().setImage({ src: url }).run()
            }
          }}
          leadingIcon={<IoImageOutline />}
        />

        {enableRephrase && onRephrase ? (
          <div className="ml-auto">
            <Button
              size="sm"
              className="mark text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-medium flex items-center gap-1"
              onClick={handleRephrase}
              loading={isRephrasing}
              title="Rephrase with AI"
              leadingIcon={<HiSparkles className="w-4 h-4 text-indigo-500" />}
            />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={classes.join(' ')}>
      {title ? <label>{title}</label> : null}
      <div className="relative form-control-wrapper inline-flex w-full ">
        <div className="form-input">
          <EditorContent editor={editor} />
          {!readOnly ? marks() : null}
        </div>
      </div>
      {helper && !error ? (
        <p className="mt-2 text-sm text-gray-500">{helper}</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}
    </div>
  )
}
