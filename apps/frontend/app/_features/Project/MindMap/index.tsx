'use client'

import { useParams } from 'next/navigation'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import localforage from 'localforage'
import {
  HiOutlineArrowsPointingOut,
  HiOutlineArrowsPointingIn,
  HiOutlineArrowPath,
  HiOutlineCheckCircle
} from 'react-icons/hi2'

const DEFAULT_MIND_MAP_XML = `<mxfile host="app.diagrams.net" modified="2026-08-04T00:00:00.000Z" agent="5.0" version="21.0.0" type="embed">
  <diagram id="mindmap-1" name="Project Thought Process Flow">
    <mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" background="none">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="root-node" value="Project Mind Map&#10;(Click to edit)" style="ellipse;whiteSpace=wrap;html=1;fillColor=#6366f1;fontColor=#ffffff;strokeColor=#4f46e5;fontStyle=1;fontSize=16;" vertex="1" parent="1">
          <mxGeometry x="480" y="260" width="200" height="80" as="geometry" />
        </mxCell>
        <mxCell id="branch-1" value="User Workflow" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e0e7ff;strokeColor=#6366f1;fontColor=#3730a3;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="240" y="160" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="edge-1" edge="1" parent="1" source="root-node" target="branch-1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#6366f1;strokeWidth=2;">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="branch-2" value="Technical Requirements" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fef3c7;strokeColor=#f59e0b;fontColor=#92400e;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="760" y="160" width="180" height="60" as="geometry" />
        </mxCell>
        <mxCell id="edge-2" edge="1" parent="1" source="root-node" target="branch-2" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#f59e0b;strokeWidth=2;">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="branch-3" value="Business Goals" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dcfce7;strokeColor=#22c55e;fontColor=#166534;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="490" y="440" width="180" height="60" as="geometry" />
        </mxCell>
        <mxCell id="edge-3" edge="1" parent="1" source="root-node" target="branch-3" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#22c55e;strokeWidth=2;">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

export default function MindMap() {
  const { projectId } = useParams()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [isSaved, setIsSaved] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [xmlData, setXmlData] = useState<string>(DEFAULT_MIND_MAP_XML)

  const storageKey = `PROJECT_MINDMAP_${projectId || 'default'}`

  // Load initial XML from storage
  useEffect(() => {
    if (!projectId) return
    localforage.getItem<string>(storageKey).then(savedXml => {
      if (savedXml && savedXml.trim().length > 0) {
        setXmlData(savedXml)
      }
    })
  }, [projectId, storageKey])

  // Save XML to localforage
  const saveMindMap = useCallback(
    (xml: string) => {
      if (!projectId || !xml) return
      setXmlData(xml)
      localforage.setItem(storageKey, xml).then(() => {
        setIsSaved(true)
      })
    },
    [projectId, storageKey]
  )

  // Handle postMessage events from Draw.io iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'string') return
      try {
        const msg = JSON.parse(event.data)

        if (msg.event === 'init') {
          // Send XML data to iframe when initialized
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({
              action: 'load',
              autosave: 1,
              xml: xmlData
            }),
            '*'
          )
        } else if (msg.event === 'autosave' || msg.event === 'save') {
          if (msg.xml) {
            setIsSaved(false)
            saveMindMap(msg.xml)
          }
        }
      } catch (err) {
        // Ignore non-JSON postMessages from extensions
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [xmlData, saveMindMap])

  const handleReset = () => {
    if (confirm('Are you sure you want to reset this project mind map to default?')) {
      saveMindMap(DEFAULT_MIND_MAP_XML)
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({
          action: 'load',
          autosave: 1,
          xml: DEFAULT_MIND_MAP_XML
        }),
        '*'
      )
    }
  }

  return (
    <div
      className={`flex flex-col bg-white dark:bg-gray-900 border rounded-xl overflow-hidden shadow-sm transition-all ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'w-full h-[calc(100dvh-140px)]'
      }`}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-gray-800 dark:text-gray-200">
            Project Mind Map & Flowchart
          </span>
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 font-medium">
            <HiOutlineCheckCircle className="w-3.5 h-3.5" />
            {isSaved ? 'Auto-Saved' : 'Saving...'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            title="Reset Mind Map"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
            <HiOutlineArrowPath className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
            {isFullscreen ? (
              <>
                <HiOutlineArrowsPointingIn className="w-3.5 h-3.5" />
                Exit Fullscreen
              </>
            ) : (
              <>
                <HiOutlineArrowsPointingOut className="w-3.5 h-3.5" />
                Fullscreen
              </>
            )}
          </button>
        </div>
      </div>

      {/* Embedded Draw.io Editor */}
      <div className="flex-1 w-full relative bg-gray-100 dark:bg-gray-950">
        <iframe
          ref={iframeRef}
          className="w-full h-full border-none"
          src="https://embed.diagrams.net/?embed=1&spin=1&modified=unsaved&proto=json&ui=min"
          title="Project Mind Map Diagram"
        />
      </div>
    </div>
  )
}
